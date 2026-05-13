import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';

interface RemoveScreenplayModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onPhaseChange?: (phaseId: string) => void;
}

export function RemoveScreenplayModal({ open, onClose, projectId, onPhaseChange }: RemoveScreenplayModalProps) {
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: () => api.removeScreenplay(projectId),
    onSuccess: () => {
      // Invalidate snapshot list (safety snapshot was created)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SNAPSHOTS(projectId) });
      // Invalidate current state cache
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CURRENT_STATE(projectId) });
      // Nuke all project data caches to prevent stale rendering
      queryClient.removeQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            key[0] === 'subsection-data' ||
            key[0] === 'list-items' ||
            key[0] === 'phase-data' ||
            (key[0] === 'project-v2' && key[1] === projectId) ||
            key[0] === 'list-item' ||
            key[0] === 'readiness'
          );
        },
      });
      onClose();
      // Navigate back to the first wizard phase (scenes) after removing screenplay
      if (onPhaseChange) {
        onPhaseChange('scenes');
      }
    },
    onError: () => {
      window.alert('Failed to remove screenplay. Please try again.');
    },
  });

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-lg shadow-xl w-[440px] max-h-[85vh] overflow-y-auto z-50 p-6">
          <Dialog.Title className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            Remove Screenplay
          </Dialog.Title>

          <Dialog.Description className="text-sm text-muted-foreground mt-3 leading-relaxed">
            This will remove all generated screenplay content and return you to the script
            writer. A safety snapshot will be created automatically so you can undo this
            action.
          </Dialog.Description>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={removeMutation.isPending}
              className="px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              className="px-4 py-2 text-sm rounded-md bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {removeMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove Screenplay'
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
