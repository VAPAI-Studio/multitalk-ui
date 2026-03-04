import React, { useState, useRef } from "react";
import { apiClient } from "../lib/apiClient";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB — S3 minimum part size
const MAX_PART_RETRIES = 3;

interface UploadState {
  status: 'idle' | 'uploading' | 'completing' | 'done' | 'error' | 'aborting';
  totalParts: number;
  completedParts: number;
  currentPartProgress: number; // 0–100 for the in-flight part
  bytesUploaded: number;
  totalBytes: number;
  uploadSpeed: number;  // bytes/sec (rolling average)
  etaSeconds: number;
  errorMessage?: string;
}

interface Props {
  targetPath: string;          // default S3 prefix (from FileTree currentPath)
  onUploadComplete: () => void; // called after successful upload; triggers tree refresh
}

export function FileUpload({ targetPath, onUploadComplete }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [customPath, setCustomPath] = useState<string>(targetPath);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle', totalParts: 0, completedParts: 0,
    currentPartProgress: 0, bytesUploaded: 0, totalBytes: 0,
    uploadSpeed: 0, etaSeconds: 0,
  });

  // Keep customPath in sync when parent navigates
  React.useEffect(() => { setCustomPath(targetPath); }, [targetPath]);

  const startTimeRef = useRef<number>(0);

  function splitIntoChunks(f: File): Blob[] {
    const chunks: Blob[] = [];
    let offset = 0;
    while (offset < f.size) {
      chunks.push(f.slice(offset, Math.min(offset + CHUNK_SIZE, f.size)));
      offset += CHUNK_SIZE;
    }
    return chunks;
  }

  function updateProgress(completedParts: number, totalParts: number, bytesUploaded: number, totalBytes: number, currentPartProgress: number) {
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const speed = elapsed > 0 ? bytesUploaded / elapsed : 0;
    const remaining = totalBytes - bytesUploaded;
    const etaSeconds = speed > 0 ? Math.round(remaining / speed) : 0;
    setUploadState(prev => ({
      ...prev,
      completedParts,
      currentPartProgress,
      bytesUploaded,
      totalBytes,
      totalParts,
      uploadSpeed: speed,
      etaSeconds,
    }));
  }

  /**
   * Upload a single part with up to MAX_PART_RETRIES attempts.
   * Uses exponential backoff: 1s, 2s, 3s between attempts.
   * Only throws after all retries are exhausted — a single network error
   * will NOT abort the entire upload.
   */
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
        const result = await apiClient.uploadPart(uploadId, key, partNumber, chunk, onProgress);
        return result;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_PART_RETRIES) {
          // Exponential backoff: 1s, 2s, 3s
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
    throw lastError ?? new Error(`Part ${partNumber} failed after ${MAX_PART_RETRIES} attempts`);
  }

  async function handleUpload() {
    if (!file) return;

    setUploadState(prev => ({ ...prev, status: 'uploading', errorMessage: undefined }));
    startTimeRef.current = Date.now();

    let uploadId: string | null = null;
    let key: string | null = null;

    try {
      // Step 1: Init
      const initResp = await apiClient.initUpload(file.name, customPath, file.size);
      uploadId = initResp.upload_id;
      key = initResp.key;

      const chunks = splitIntoChunks(file);
      const collectedParts: Array<{ part_number: number; etag: string }> = [];

      setUploadState(prev => ({
        ...prev,
        totalParts: chunks.length,
        totalBytes: file.size,
        status: 'uploading',
      }));

      // Step 2: Upload parts sequentially with per-part retry
      for (let i = 0; i < chunks.length; i++) {
        const partNumber = i + 1;
        const bytesBeforePart = i * CHUNK_SIZE;

        // Per-part retry: up to MAX_PART_RETRIES attempts before propagating error
        const partResult = await uploadPartWithRetry(
          uploadId,
          key,
          partNumber,
          chunks[i],
          (loaded, total) => {
            updateProgress(
              i,                          // parts fully done
              chunks.length,
              bytesBeforePart + loaded,
              file.size,
              Math.round((loaded / total) * 100)
            );
          }
        );

        collectedParts.push({ part_number: partResult.part_number, etag: partResult.etag });
        updateProgress(i + 1, chunks.length, Math.min((i + 1) * CHUNK_SIZE, file.size), file.size, 0);
      }

      // Step 3: Complete
      setUploadState(prev => ({ ...prev, status: 'completing' }));
      await apiClient.completeUpload(uploadId, key, collectedParts);

      setUploadState(prev => ({ ...prev, status: 'done' }));
      onUploadComplete();

    } catch (err: any) {
      // CRITICAL: Always abort to prevent orphaned parts and storage charges.
      // Only reached after all per-part retries are exhausted.
      if (uploadId && key) {
        setUploadState(prev => ({ ...prev, status: 'aborting' }));
        try {
          await apiClient.abortUpload(uploadId, key);
        } catch {
          // Abort best-effort — log but don't throw
          console.error('Failed to abort multipart upload:', uploadId);
        }
      }
      setUploadState(prev => ({
        ...prev,
        status: 'error',
        errorMessage: err.message || 'Upload failed',
      }));
    }
  }

  function handleReset() {
    setFile(null);
    setUploadState({
      status: 'idle', totalParts: 0, completedParts: 0,
      currentPartProgress: 0, bytesUploaded: 0, totalBytes: 0,
      uploadSpeed: 0, etaSeconds: 0,
    });
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

  const overallPercent = uploadState.totalBytes > 0
    ? Math.round((uploadState.bytesUploaded / uploadState.totalBytes) * 100)
    : 0;
  const isActive = ['uploading', 'completing', 'aborting'].includes(uploadState.status);

  return (
    <div className="rounded-3xl border border-gray-200/80 shadow-lg bg-white overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-gray-200 px-6 py-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
          <span>⬆️</span>
          Upload to Network Volume
        </h2>
        <p className="text-sm text-gray-600 mt-1">Upload files to the RunPod network volume (supports up to 10GB)</p>
      </div>

      <div className="p-6 space-y-4">
        {/* File picker */}
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-2">File</label>
          <input
            type="file"
            disabled={isActive}
            onChange={(e) => {
              handleReset();
              const f = e.target.files?.[0] || null;
              setFile(f);
            }}
            className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-4 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-slate-600 file:to-gray-700 file:text-white file:font-semibold hover:file:from-slate-700 hover:file:to-gray-800 transition-all duration-200 bg-gray-50/50 disabled:opacity-50"
          />
          {file && (
            <p className="mt-2 text-sm text-gray-500">
              {file.name} — {formatBytes(file.size)}
            </p>
          )}
        </div>

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
            disabled={isActive}
            placeholder="e.g. models/checkpoints (empty = root)"
            className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-slate-500 focus:ring-4 focus:ring-slate-100 transition-all duration-200 bg-white/80 disabled:opacity-50"
          />
        </div>

        {/* Progress bar (visible while uploading or done) */}
        {uploadState.status !== 'idle' && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>
                {uploadState.status === 'uploading' && `Part ${uploadState.completedParts + 1} of ${uploadState.totalParts}`}
                {uploadState.status === 'completing' && 'Finalizing upload…'}
                {uploadState.status === 'aborting' && 'Aborting…'}
                {uploadState.status === 'done' && 'Upload complete'}
                {uploadState.status === 'error' && 'Upload failed'}
              </span>
              <span>{overallPercent}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all duration-300 ${
                  uploadState.status === 'done' ? 'bg-green-500' :
                  uploadState.status === 'error' ? 'bg-red-500' :
                  'bg-gradient-to-r from-slate-600 to-gray-700'
                }`}
                style={{ width: `${overallPercent}%` }}
              />
            </div>
            {uploadState.status === 'uploading' && uploadState.uploadSpeed > 0 && (
              <div className="flex justify-between text-xs text-gray-400">
                <span>{formatBytes(uploadState.uploadSpeed)}/s</span>
                <span>ETA: {formatETA(uploadState.etaSeconds)}</span>
              </div>
            )}
          </div>
        )}

        {/* Error message */}
        {uploadState.status === 'error' && uploadState.errorMessage && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
            <span className="font-semibold">Error: </span>{uploadState.errorMessage}
          </div>
        )}

        {/* Success message */}
        {uploadState.status === 'done' && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-2xl text-sm text-green-700">
            File uploaded successfully. File tree refreshed.
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleUpload}
            disabled={!file || isActive}
            className="px-6 py-3 rounded-2xl bg-gradient-to-r from-slate-600 to-gray-700 text-white font-bold shadow-lg hover:from-slate-700 hover:to-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-2"
          >
            {isActive ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {uploadState.status === 'completing' ? 'Finalizing…' : uploadState.status === 'aborting' ? 'Aborting…' : 'Uploading…'}
              </>
            ) : (
              <>
                <span>⬆️</span>
                Upload
              </>
            )}
          </button>
          {(uploadState.status === 'done' || uploadState.status === 'error') && (
            <button
              onClick={handleReset}
              className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold transition-all duration-200"
            >
              Upload Another
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
