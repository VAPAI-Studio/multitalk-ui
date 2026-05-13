import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { BreakdownElement } from '../../types';
import { MediaThumbnail } from './MediaThumbnail';
import { AudioPlayer } from './AudioPlayer';
import { MediaUploadZone } from './MediaUploadZone';

interface AssetElementCardProps {
  element: BreakdownElement;
  projectId: string;
  onPlaybackStart: (mediaId: string, stopFn: () => void) => void;
}

export function AssetElementCard({ element, projectId, onPlaybackStart }: AssetElementCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data: media } = useQuery({
    queryKey: QUERY_KEYS.ELEMENT_MEDIA(element.id),
    queryFn: () => api.listElementMedia(projectId, element.id),
    enabled: isExpanded,
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (mediaId: string) => api.deleteMedia(projectId, mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ELEMENT_MEDIA(element.id) });
    },
  });

  const handleDeleteMedia = (mediaId: string, filename: string) => {
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    deleteMutation.mutate(mediaId);
  };

  const images = (media ?? []).filter(m => m.file_type === 'image');
  const audioFiles = (media ?? []).filter(m => m.file_type === 'audio');
  const mediaCount = (media ?? []).length;

  return (
    <div className="rounded-lg border border-border/50 hover:border-border bg-card/40 hover:bg-card/60 transition-all">
      {/* Header row (always visible, clickable) */}
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer"
        onClick={() => setIsExpanded(prev => !prev)}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <span className="text-sm font-semibold text-foreground truncate flex-1">
          {element.name}
        </span>
        {mediaCount > 0 && (
          <span className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded-full tabular-nums text-muted-foreground">
            {mediaCount}
          </span>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 animate-accordion-down">
          {element.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
              {element.description}
            </p>
          )}

          {/* Image thumbnails */}
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-2">
              {images.map(img => (
                <MediaThumbnail
                  key={img.id}
                  filePath={img.file_path}
                  thumbnailPath={img.thumbnail_path}
                  originalFilename={img.original_filename}
                  onDelete={() => handleDeleteMedia(img.id, img.original_filename)}
                />
              ))}
            </div>
          )}

          {/* Audio players */}
          {audioFiles.length > 0 && (
            <div className="space-y-2 mb-2">
              {audioFiles.map(audio => (
                <div key={audio.id} className="relative group flex items-center gap-2">
                  <div className="flex-1">
                    <AudioPlayer
                      src={audio.file_path}
                      filename={audio.original_filename}
                      mediaId={audio.id}
                      onPlaybackStart={onPlaybackStart}
                    />
                  </div>
                  <button
                    onClick={() => handleDeleteMedia(audio.id, audio.original_filename)}
                    className="h-6 w-6 flex items-center justify-center flex-shrink-0
                      bg-background/80 hover:bg-destructive hover:text-destructive-foreground
                      rounded text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
                    aria-label="Delete audio"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Upload zone */}
          <MediaUploadZone projectId={projectId} elementId={element.id} />
        </div>
      )}
    </div>
  );
}
