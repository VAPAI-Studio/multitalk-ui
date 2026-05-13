import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../UI/Button';
import { QUERY_KEYS, ROUTES } from '../../lib/constants';

interface CreateShowModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateShowModal({ open, onOpenChange }: CreateShowModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const createShowMutation = useMutation({
    mutationFn: api.createShow,
    onSuccess: (show) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SHOWS] });
      onOpenChange(false);
      setTitle('');
      setDescription('');
      navigate(ROUTES.SHOW(show.id));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createShowMutation.mutate({ title, description: description || undefined });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[90vw] max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card border border-border p-0 shadow-2xl shadow-black/40 data-[state=open]:animate-scale-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <Dialog.Title className="font-display text-xl font-semibold text-foreground">
              New Show
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-5">
            {/* Title */}
            <div>
              <label htmlFor="show-title" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Title
              </label>
              <input
                id="show-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/40 transition-all"
                placeholder="My TV Show"
                required
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="show-description" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Description
              </label>
              <textarea
                id="show-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/40 transition-all resize-none"
                placeholder="What's this show about?"
                rows={3}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2.5 pt-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!title || createShowMutation.isPending}
              >
                {createShowMutation.isPending ? 'Creating...' : 'Create Show'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
