import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';

interface MediaUploadZoneProps {
  projectId: string;
  elementId: string;
}

export function MediaUploadZone({ projectId, elementId }: MediaUploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Auto-clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('element_id', elementId);
      return api.uploadMedia(projectId, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ELEMENT_MEDIA(elementId) });
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => uploadMutation.mutate(file));
  }, [uploadMutation]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => uploadMutation.mutate(file));
    e.target.value = '';
  }, [uploadMutation]);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`mt-3 border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer min-h-[80px] flex flex-col items-center justify-center gap-1 ${
        isDragOver
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-border-strong'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,audio/x-m4a"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      {uploadMutation.isPending ? (
        <>
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
          <span className="text-xs text-muted-foreground">Uploading...</span>
        </>
      ) : error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : isDragOver ? (
        <>
          <Upload className="h-6 w-6 text-primary" />
          <span className="text-xs text-primary font-medium">Drop to upload</span>
        </>
      ) : (
        <>
          <Upload className="h-6 w-6 text-muted-foreground/40" />
          <span className="text-xs text-muted-foreground">Drop files here or click to upload</span>
          <span className="text-[10px] text-muted-foreground/50">Images (JPEG, PNG, WebP) and audio (MP3, WAV, M4A) up to 20MB</span>
        </>
      )}
    </div>
  );
}
