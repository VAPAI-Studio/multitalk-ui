import { useState } from 'react';
import { Image, Trash2 } from 'lucide-react';

interface MediaThumbnailProps {
  filePath: string;
  thumbnailPath: string | null;
  originalFilename: string;
  onDelete?: () => void;
}

export function MediaThumbnail({ filePath, thumbnailPath, originalFilename, onDelete }: MediaThumbnailProps) {
  const [imgError, setImgError] = useState(false);
  const src = thumbnailPath || filePath;

  if (imgError || !src) {
    return (
      <div className="relative group w-20 h-20 rounded-md border border-border/50 bg-muted flex items-center justify-center">
        <Image className="h-6 w-6 text-muted-foreground/40" />
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center
              bg-background/80 hover:bg-destructive hover:text-destructive-foreground
              rounded text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
            aria-label="Delete image"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative group">
      <img
        src={src}
        alt={originalFilename}
        onClick={() => window.open(filePath, '_blank')}
        onError={() => setImgError(true)}
        className="w-20 h-20 rounded-md border border-border/50 object-cover cursor-pointer hover:opacity-80 transition-opacity"
      />
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center
            bg-background/80 hover:bg-destructive hover:text-destructive-foreground
            rounded text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Delete image"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
