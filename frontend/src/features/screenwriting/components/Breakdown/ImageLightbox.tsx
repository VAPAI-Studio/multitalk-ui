import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { AssetMedia } from '../../types';

interface ImageLightboxProps {
  image: AssetMedia | null;
  onClose: () => void;
}

export function ImageLightbox({ image, onClose }: ImageLightboxProps) {
  return (
    <Dialog.Root open={!!image} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
        <Dialog.Content className="fixed inset-4 z-50 flex items-center justify-center">
          <Dialog.Title className="sr-only">
            {image?.original_filename || 'Image preview'}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Fullscreen preview of {image?.original_filename || 'selected image'}
          </Dialog.Description>
          {image && (
            <img
              src={image.file_path}
              alt={image.original_filename}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          )}
          <Dialog.Close asChild>
            <button
              className="absolute top-2 right-2 h-10 w-10 flex items-center justify-center bg-background/80 hover:bg-background rounded-full text-foreground transition-colors"
              aria-label="Close lightbox"
            >
              <X className="h-5 w-5" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
