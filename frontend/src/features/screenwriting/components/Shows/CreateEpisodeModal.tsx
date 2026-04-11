import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../UI/Button';
import { QUERY_KEYS } from '../../lib/constants';
import { Framework } from '../../types';
import { FRAMEWORK_LABELS } from '../../lib/section-config';

interface CreateEpisodeModalProps {
  showId: string;
  nextEpisodeNumber: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateEpisodeModal({ showId, nextEpisodeNumber, open, onOpenChange }: CreateEpisodeModalProps) {
  const [title, setTitle] = useState('');
  const [framework, setFramework] = useState<Framework>(Framework.THREE_ACT);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: { title: string; framework: string }) =>
      api.createEpisode(showId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.EPISODES(showId) });
      onOpenChange(false);
      setTitle('');
      setFramework(Framework.THREE_ACT);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ title, framework });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[90vw] max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card border border-border p-0 shadow-2xl shadow-black/40 data-[state=open]:animate-scale-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <Dialog.Title className="font-display text-xl font-semibold text-foreground">
              New Episode
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-5">
            {/* Episode Number Preview */}
            <p className="text-sm text-muted-foreground">
              Will be <span className="font-medium text-indigo-400">Episode {nextEpisodeNumber}</span>
            </p>

            {/* Title */}
            <div>
              <label htmlFor="episode-title" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Title
              </label>
              <input
                id="episode-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
                placeholder="Episode title"
                required
                autoFocus
              />
            </div>

            {/* Framework */}
            <div>
              <label htmlFor="episode-framework" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Framework
              </label>
              <select
                id="episode-framework"
                value={framework}
                onChange={(e) => setFramework(e.target.value as Framework)}
                className="w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/40 transition-all"
              >
                {Object.entries(FRAMEWORK_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2.5 pt-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!title.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Create Episode'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
