import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, BREAKDOWN_CATEGORIES } from '../../lib/constants';
import type { BreakdownCategory } from '../../types';

interface AddElementDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddElementDialog({ projectId, open, onOpenChange }: AddElementDialogProps) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<BreakdownCategory>('character');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      api.createBreakdownElement(projectId, {
        category,
        name: name.trim(),
        description: description.trim(),
      }),
    onSuccess: () => {
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category) });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_SUMMARY(projectId) });
    },
  });

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setCategory('character');
      setName('');
      setDescription('');
      createMutation.reset();
    }
    onOpenChange(open);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) createMutation.mutate();
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[90vw] max-w-[480px]
          -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card border border-border p-0
          shadow-2xl shadow-black/40 data-[state=open]:animate-scale-in overflow-hidden z-50">
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <Dialog.Title className="font-display text-xl font-semibold text-foreground">
              Add Element
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Category
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as BreakdownCategory)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground
                  focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {BREAKDOWN_CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={500}
                placeholder="e.g. Detective Morales"
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground
                  placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Description
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Optional notes…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground
                  placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            {createMutation.isError && (
              <p className="text-xs text-red-400">
                Failed to create element. Please try again.
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground
                    hover:bg-muted rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={!name.trim() || createMutation.isPending}
                className="px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-white
                  rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending ? 'Adding…' : 'Add Element'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
