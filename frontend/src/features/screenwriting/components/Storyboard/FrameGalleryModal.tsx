// frontend/src/components/Storyboard/FrameGalleryModal.tsx

import { useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Upload, Check, Trash2, Sparkles, Image, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { Shot, StoryboardFrame } from '../../types';

interface FrameGalleryModalProps {
  shot: Shot;
  projectId: string;
  sceneLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FrameGalleryModal({ shot, projectId, sceneLabel, open, onOpenChange }: FrameGalleryModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: frames = [], isLoading } = useQuery<StoryboardFrame[]>({
    queryKey: QUERY_KEYS.STORYBOARD_FRAMES(shot.id),
    queryFn: () => api.listFrames(projectId, shot.id),
    enabled: open,
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => api.uploadFrame(projectId, shot.id, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STORYBOARD_FRAMES(shot.id) });
    },
  });

  const selectMutation = useMutation({
    mutationFn: (frameId: string) => api.updateFrame(projectId, frameId, { is_selected: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STORYBOARD_FRAMES(shot.id) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (frameId: string) => api.deleteFrame(projectId, frameId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STORYBOARD_FRAMES(shot.id) });
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => api.generateFrame(projectId, shot.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STORYBOARD_FRAMES(shot.id) });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    uploadMutation.mutate(formData);
    e.target.value = '';
  };

  const handleDelete = (frameId: string) => {
    if (window.confirm('Delete this frame?')) {
      deleteMutation.mutate(frameId);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in z-40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 max-h-[85vh] w-[90vw] max-w-[720px]
            -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card border border-border
            shadow-2xl shadow-black/40 data-[state=open]:animate-scale-in overflow-hidden z-50
            flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <div>
              <Dialog.Title className="font-display text-lg font-semibold text-foreground">
                Shot #{shot.shot_number} — Frames
              </Dialog.Title>
              <p className="text-xs text-muted-foreground mt-0.5">{sceneLabel}</p>
            </div>
            <Dialog.Close asChild>
              <button className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Shot description bar */}
          {shot.fields.description && (
            <div className="px-6 pb-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{shot.fields.description}</p>
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-2 px-6 pb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold
                bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed border border-primary/20"
            >
              {uploadMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Upload className="h-3.5 w-3.5" />}
              {uploadMutation.isPending ? 'Uploading...' : 'Upload Frame'}
            </button>
            <button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold
                bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 rounded-lg transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed border border-violet-500/20"
            >
              {generateMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />}
              {generateMutation.isPending ? 'Generating...' : 'Generate with AI'}
            </button>
          </div>

          {/* Frame gallery — scrollable */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary/40" />
              </div>
            ) : frames.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Image className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No frames yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Upload an image or generate one with AI.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {frames.map((frame) => (
                  <div
                    key={frame.id}
                    className={`relative group rounded-lg overflow-hidden border-2 transition-colors ${
                      frame.is_selected
                        ? 'border-primary shadow-md shadow-primary/10'
                        : 'border-transparent hover:border-border'
                    }`}
                  >
                    {/* Frame image */}
                    <div className="aspect-video bg-muted/30">
                      <img
                        src={frame.thumbnail_path ?? frame.file_path}
                        alt={`Frame for shot ${shot.shot_number}`}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Selected badge */}
                    {frame.is_selected && (
                      <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded">
                        <Check className="h-2.5 w-2.5" />
                        Selected
                      </div>
                    )}

                    {/* AI badge */}
                    {frame.generation_source === 'ai' && (
                      <div className="absolute top-1.5 right-1.5 bg-primary/80 text-primary-foreground p-0.5 rounded">
                        <Sparkles className="h-2.5 w-2.5" />
                      </div>
                    )}

                    {/* Hover actions overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end justify-center gap-2 p-2 opacity-0 group-hover:opacity-100">
                      {!frame.is_selected && (
                        <button
                          onClick={() => selectMutation.mutate(frame.id)}
                          disabled={selectMutation.isPending}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold
                            bg-white/90 text-gray-900 rounded-md hover:bg-white transition-colors"
                        >
                          <Check className="h-2.5 w-2.5" />
                          Select
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(frame.id)}
                        disabled={deleteMutation.isPending}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold
                          bg-red-500/90 text-white rounded-md hover:bg-red-500 transition-colors"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Upload error */}
            {uploadMutation.isError && (
              <p className="text-xs text-red-400 mt-3">
                Upload failed: {uploadMutation.error instanceof Error ? uploadMutation.error.message : 'Unknown error'}
              </p>
            )}

            {/* Generate error */}
            {generateMutation.isError && (
              <p className="text-xs text-red-400 mt-3">
                Generation failed: {generateMutation.error instanceof Error ? generateMutation.error.message : 'Unknown error'}
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
