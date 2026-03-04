import React, { useState, useRef } from "react";
import { apiClient } from "../lib/apiClient";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB — S3 minimum part size
const MAX_PART_RETRIES = 3;

interface FileQueueItem {
  file: File;
  targetPath: string; // full S3 key (path + relative structure for folders)
}

type FileStatus = 'pending' | 'uploading' | 'done' | 'error';

interface FileProgress {
  status: FileStatus;
  percentDone: number;       // 0–100 overall for this file
  speed: number;             // bytes/sec
  etaSeconds: number;
  errorMessage?: string;
}

interface Props {
  targetPath: string;          // default S3 prefix (from FileTree currentPath)
  onUploadComplete: () => void; // called after each successful upload; triggers tree refresh
}

export function FileUpload({ targetPath, onUploadComplete }: Props) {
  const [queue, setQueue] = useState<FileQueueItem[]>([]);
  const [customPath, setCustomPath] = useState<string>(targetPath);
  const [progresses, setProgresses] = useState<FileProgress[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const startTimesRef = useRef<number[]>([]);

  // Keep customPath in sync when parent navigates
  React.useEffect(() => { setCustomPath(targetPath); }, [targetPath]);

  function buildTargetPath(file: File, basePath: string): string {
    // For folder uploads webkitRelativePath includes the top-level folder name
    // e.g. "my-loras/subfolder/model.safetensors"
    const rel = (file as any).webkitRelativePath as string | undefined;
    const name = rel && rel.length > 0 ? rel : file.name;
    return basePath ? `${basePath.replace(/\/+$/, '')}/${name}` : name;
  }

  function addFiles(files: FileList | null, isFolder: boolean) {
    if (!files || files.length === 0) return;
    const items: FileQueueItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // Skip folder placeholder entries (0-byte files with trailing slash names) that some
      // browsers emit when using webkitdirectory — they're not real files.
      if (isFolder && f.size === 0) continue;
      items.push({ file: f, targetPath: buildTargetPath(f, customPath) });
    }
    setQueue(prev => [...prev, ...items]);
    setProgresses(prev => [
      ...prev,
      ...items.map((): FileProgress => ({
        status: 'pending', percentDone: 0, speed: 0, etaSeconds: 0,
      })),
    ]);
    // Reset input so same selection can be re-added after reset
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }

  function removeItem(idx: number) {
    setQueue(prev => prev.filter((_, i) => i !== idx));
    setProgresses(prev => prev.filter((_, i) => i !== idx));
  }

  function resetAll() {
    setQueue([]);
    setProgresses([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }

  function splitIntoChunks(f: File): Blob[] {
    const chunks: Blob[] = [];
    let offset = 0;
    while (offset < f.size) {
      chunks.push(f.slice(offset, Math.min(offset + CHUNK_SIZE, f.size)));
      offset += CHUNK_SIZE;
    }
    return chunks;
  }

  async function uploadPartWithRetry(
    uploadId: string,
    key: string,
    partNumber: number,
    chunk: Blob,
    onProgress: (loaded: number, total: number) => void
  ): Promise<{ part_number: number; etag: string }> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_PART_RETRIES; attempt++) {
      try {
        return await apiClient.uploadPart(uploadId, key, partNumber, chunk, onProgress);
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_PART_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    throw lastError ?? new Error(`Part ${partNumber} failed after ${MAX_PART_RETRIES} attempts`);
  }

  async function uploadSingleFile(item: FileQueueItem, queueIdx: number) {
    const { file, targetPath: path } = item;
    startTimesRef.current[queueIdx] = Date.now();

    const setProgress = (patch: Partial<FileProgress>) => {
      setProgresses(prev => {
        const next = [...prev];
        next[queueIdx] = { ...next[queueIdx], ...patch };
        return next;
      });
    };

    setProgress({ status: 'uploading', percentDone: 0, errorMessage: undefined });

    // Extract directory from targetPath for the init call
    const lastSlash = path.lastIndexOf('/');
    const directory = lastSlash >= 0 ? path.substring(0, lastSlash) : '';
    const filename = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;

    let uploadId: string | null = null;
    let key: string | null = null;

    try {
      const initResp = await apiClient.initUpload(filename, directory, file.size);
      uploadId = initResp.upload_id;
      key = initResp.key;

      const chunks = splitIntoChunks(file);
      const collectedParts: Array<{ part_number: number; etag: string }> = [];

      for (let i = 0; i < chunks.length; i++) {
        const partNumber = i + 1;
        const bytesBeforePart = i * CHUNK_SIZE;
        const partResult = await uploadPartWithRetry(
          uploadId, key, partNumber, chunks[i],
          (loaded, _total) => {
            const bytesUploaded = bytesBeforePart + loaded;
            const elapsed = (Date.now() - startTimesRef.current[queueIdx]) / 1000;
            const speed = elapsed > 0 ? bytesUploaded / elapsed : 0;
            const remaining = file.size - bytesUploaded;
            setProgress({
              percentDone: Math.round((bytesUploaded / file.size) * 100),
              speed,
              etaSeconds: speed > 0 ? Math.round(remaining / speed) : 0,
            });
          }
        );
        collectedParts.push({ part_number: partResult.part_number, etag: partResult.etag });
      }

      await apiClient.completeUpload(uploadId, key, collectedParts);
      setProgress({ status: 'done', percentDone: 100, speed: 0, etaSeconds: 0 });
      onUploadComplete();

    } catch (err: any) {
      if (uploadId && key) {
        try { await apiClient.abortUpload(uploadId, key); } catch { /* best-effort */ }
      }
      setProgress({ status: 'error', errorMessage: err.message || 'Upload failed' });
    }
  }

  async function handleUploadAll() {
    if (queue.length === 0 || isRunning) return;
    setIsRunning(true);
    // Upload sequentially to avoid overwhelming bandwidth / S3 connection limits
    for (let i = 0; i < queue.length; i++) {
      const prog = progresses[i];
      if (prog?.status === 'done') continue; // already done (e.g. retrying errors only)
      await uploadSingleFile(queue[i], i);
    }
    setIsRunning(false);
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatETA(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  const totalFiles = queue.length;
  const doneCount = progresses.filter(p => p.status === 'done').length;
  const errorCount = progresses.filter(p => p.status === 'error').length;
  const allDone = totalFiles > 0 && doneCount + errorCount === totalFiles;

  return (
    <div className="rounded-3xl border border-gray-200/80 shadow-lg bg-white overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200 px-6 py-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
          <span>⬆️</span>
          Upload to Network Volume
        </h2>
        <p className="text-sm text-gray-600 mt-1">
          Upload files or entire folders to the RunPod network volume (supports up to 10GB per file)
        </p>
      </div>

      <div className="p-6 space-y-4">
        {/* Target directory */}
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-2">
            Target Directory
            <span className="ml-2 text-xs text-gray-400 font-normal">(defaults to current browsed path)</span>
          </label>
          <input
            type="text"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            disabled={isRunning}
            placeholder="e.g. models/checkpoints (empty = root)"
            className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-slate-500 focus:ring-4 focus:ring-slate-100 transition-all duration-200 bg-white/80 disabled:opacity-50"
          />
        </div>

        {/* Pickers */}
        <div className="flex gap-3">
          {/* Multi-file picker */}
          <div className="flex-1">
            <label className="block text-sm font-semibold text-gray-800 mb-2">Add Files</label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={isRunning}
              onChange={(e) => addFiles(e.target.files, false)}
              className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-3 text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-slate-600 file:to-gray-700 file:text-white file:text-sm file:font-semibold hover:file:from-slate-700 hover:file:to-gray-800 transition-all duration-200 bg-gray-50/50 disabled:opacity-50"
            />
          </div>

          {/* Folder picker */}
          <div className="flex-1">
            <label className="block text-sm font-semibold text-gray-800 mb-2">Add Folder</label>
            <input
              ref={folderInputRef}
              type="file"
              // @ts-ignore — non-standard but widely supported
              webkitdirectory=""
              disabled={isRunning}
              onChange={(e) => addFiles(e.target.files, true)}
              className="w-full rounded-2xl border-2 border-dashed border-blue-200 px-4 py-3 text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-blue-600 file:text-white file:text-sm file:font-semibold hover:file:from-blue-600 hover:file:to-blue-700 transition-all duration-200 bg-blue-50/30 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Queue list */}
        {queue.length > 0 && (
          <div className="border border-gray-200 rounded-2xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">
                Queue — {totalFiles} file{totalFiles !== 1 ? 's' : ''}
                {doneCount > 0 && ` · ${doneCount} done`}
                {errorCount > 0 && ` · ${errorCount} failed`}
              </span>
              {!isRunning && (
                <button
                  onClick={resetAll}
                  className="text-xs text-gray-500 hover:text-red-600 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {queue.map((item, idx) => {
                const prog = progresses[idx] ?? { status: 'pending', percentDone: 0, speed: 0, etaSeconds: 0 };
                return (
                  <div key={idx} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {/* Status icon */}
                      <span className="flex-shrink-0 text-base">
                        {prog.status === 'pending' && '○'}
                        {prog.status === 'uploading' && (
                          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block" />
                        )}
                        {prog.status === 'done' && <span className="text-green-600">✓</span>}
                        {prog.status === 'error' && <span className="text-red-600">✗</span>}
                      </span>

                      {/* File info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate" title={item.targetPath}>
                          {item.file.name}
                        </p>
                        <p className="text-xs text-gray-400 truncate">→ {item.targetPath} · {formatBytes(item.file.size)}</p>
                        {prog.status === 'error' && prog.errorMessage && (
                          <p className="text-xs text-red-600 mt-0.5">{prog.errorMessage}</p>
                        )}
                      </div>

                      {/* Progress % or remove button */}
                      {prog.status === 'uploading' && (
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          {prog.percentDone}%
                          {prog.speed > 0 && ` · ${formatBytes(prog.speed)}/s`}
                          {prog.etaSeconds > 0 && ` · ${formatETA(prog.etaSeconds)}`}
                        </span>
                      )}
                      {prog.status === 'pending' && !isRunning && (
                        <button
                          onClick={() => removeItem(idx)}
                          className="text-xs text-gray-400 hover:text-red-600 flex-shrink-0 transition-colors"
                          title="Remove from queue"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Per-file progress bar */}
                    {(prog.status === 'uploading' || prog.status === 'done') && (
                      <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300 ${
                            prog.status === 'done' ? 'bg-green-500' : 'bg-gradient-to-r from-slate-600 to-gray-700'
                          }`}
                          style={{ width: `${prog.percentDone}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleUploadAll}
            disabled={queue.length === 0 || isRunning || allDone}
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-slate-600 to-gray-700 text-white font-bold shadow-lg hover:from-slate-700 hover:to-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-2"
          >
            {isRunning ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Uploading {doneCount + 1} of {totalFiles}…
              </>
            ) : (
              <>
                <span>⬆️</span>
                {queue.length > 1 ? `Upload ${queue.length} Files` : 'Upload'}
              </>
            )}
          </button>
          {(allDone || (!isRunning && queue.length > 0)) && (
            <button
              onClick={resetAll}
              disabled={isRunning}
              className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold transition-all duration-200"
            >
              {allDone ? 'Upload More' : 'Clear'}
            </button>
          )}
        </div>

        {/* All done banner */}
        {allDone && errorCount === 0 && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-2xl text-sm text-green-700">
            All {totalFiles} file{totalFiles !== 1 ? 's' : ''} uploaded successfully. File tree refreshed.
          </div>
        )}
        {allDone && errorCount > 0 && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-700">
            {doneCount} uploaded, {errorCount} failed. Fix errors above then retry.
          </div>
        )}
      </div>
    </div>
  );
}
