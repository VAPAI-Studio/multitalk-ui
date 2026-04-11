import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Expand, ImageIcon } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { MediaUploadZone } from './MediaUploadZone';
import { ImageLightbox } from './ImageLightbox';
import type { AssetMedia } from '../../types';

interface ReferenceImageGalleryProps {
  projectId: string;
  elementId: string;
}

export function ReferenceImageGallery({ projectId, elementId }: ReferenceImageGalleryProps) {
  const queryClient = useQueryClient();
  const [expandedImage, setExpandedImage] = useState<AssetMedia | null>(null);

  const { data } = useQuery({
    queryKey: QUERY_KEYS.ELEMENT_MEDIA(elementId),
    queryFn: () => api.listElementMedia(projectId, elementId),
  });

  const deleteMutation = useMutation({
    mutationFn: (mediaId: string) => api.deleteMedia(projectId, mediaId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ELEMENT_MEDIA(elementId) });
    },
  });

  const handleDelete = (media: AssetMedia) => {
    if (window.confirm(`Delete "${media.original_filename}"?`)) {
      deleteMutation.mutate(media.id);
    }
  };

  const images = (data || []).filter((m) => m.file_type === 'image');

  return (
    <div className="space-y-4">
      <MediaUploadZone projectId={projectId} elementId={elementId} />

      {images.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40">
          <ImageIcon className="h-10 w-10 mb-2" />
          <span className="text-sm">No reference images yet</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {images.map((img) => (
            <div key={img.id} className="relative group aspect-square">
              <img
                src={img.thumbnail_path || img.file_path}
                alt={img.original_filename}
                className="w-full h-full object-cover rounded-lg border border-border/50 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setExpandedImage(img)}
              />
              {/* Delete button overlay */}
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(img); }}
                className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center bg-background/80 hover:bg-destructive hover:text-destructive-foreground rounded-md text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
                aria-label={`Delete ${img.original_filename}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {/* Expand button overlay */}
              <button
                onClick={(e) => { e.stopPropagation(); setExpandedImage(img); }}
                className="absolute bottom-2 right-2 h-7 w-7 flex items-center justify-center bg-background/80 hover:bg-foreground/10 rounded-md text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
                aria-label={`Expand ${img.original_filename}`}
              >
                <Expand className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ImageLightbox image={expandedImage} onClose={() => setExpandedImage(null)} />
    </div>
  );
}
