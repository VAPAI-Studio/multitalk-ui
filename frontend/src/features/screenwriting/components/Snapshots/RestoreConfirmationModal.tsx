import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import * as Checkbox from '@radix-ui/react-checkbox';
import { Loader2, AlertTriangle, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { Snapshot, SnapshotDetail } from '../../types';

interface RestoreConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  snapshot: Snapshot;
  snapshotDetail: SnapshotDetail | undefined;
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual snapshot',
  auto_wizard: 'Before Wizard',
  auto_yolo: 'Before Auto-fill',
  pre_restore: 'Before Restore',
};

export function RestoreConfirmationModal({
  open,
  onClose,
  projectId,
  snapshot,
  snapshotDetail,
}: RestoreConfirmationModalProps) {
  const queryClient = useQueryClient();

  const phaseNames = snapshotDetail
    ? [...new Set(snapshotDetail.data.phase_data.map((pd) => pd.phase))]
    : [];

  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(new Set(phaseNames));

  useEffect(() => {
    setSelectedPhases(new Set(phaseNames));
  }, [snapshotDetail]);

  const allSelected = phaseNames.length > 0 && selectedPhases.size === phaseNames.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedPhases(new Set());
    } else {
      setSelectedPhases(new Set(phaseNames));
    }
  };

  const togglePhase = (phase: string) => {
    setSelectedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  };

  const restoreMutation = useMutation({
    mutationFn: () => {
      const isFullRestore = !snapshotDetail || selectedPhases.size === phaseNames.length;
      const phaseIds = isFullRestore ? undefined : Array.from(selectedPhases);
      return api.restoreSnapshot(projectId, snapshot.id, phaseIds);
    },
    onSuccess: () => {
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
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SNAPSHOTS(projectId) });
      onClose();
    },
  });

  const label = snapshot.label || TRIGGER_LABELS[snapshot.trigger_type] || 'Snapshot';
  const timestamp = new Date(snapshot.created_at).toLocaleString();

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-lg shadow-xl w-[440px] max-h-[85vh] overflow-y-auto z-50 p-6">
          <Dialog.Title className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Restore Snapshot
          </Dialog.Title>

          <Dialog.Description className="text-sm text-muted-foreground mt-2">
            Your current state will be saved as a safety snapshot before restoring.
          </Dialog.Description>

          <div className="mt-4 bg-muted/30 rounded-md p-3 space-y-1">
            <div className="text-sm font-medium text-foreground">{label}</div>
            <div className="text-xs text-muted-foreground">{timestamp}</div>
            {snapshot.metadata && (
              <div className="text-xs text-muted-foreground/60">
                {snapshot.metadata.phase_data_count} phases, {snapshot.metadata.list_item_count} items
              </div>
            )}
          </div>

          {phaseNames.length > 1 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">Phases to restore</span>
                <button
                  onClick={toggleAll}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {phaseNames.map((phase) => (
                  <label
                    key={phase}
                    className="flex items-center gap-2 cursor-pointer hover:bg-muted/20 rounded px-2 py-1 transition-colors"
                  >
                    <Checkbox.Root
                      checked={selectedPhases.has(phase)}
                      onCheckedChange={() => togglePhase(phase)}
                      className="w-4 h-4 rounded border border-border flex items-center justify-center data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground transition-colors"
                    >
                      <Checkbox.Indicator>
                        <Check className="h-3 w-3" />
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                    <span className="text-sm text-foreground capitalize">{phase}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={restoreMutation.isPending}
              className="px-4 py-2 text-sm rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => restoreMutation.mutate()}
              disabled={restoreMutation.isPending || (phaseNames.length > 1 && selectedPhases.size === 0)}
              className="px-4 py-2 text-sm rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {restoreMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Restoring...
                </>
              ) : (
                'Restore'
              )}
            </button>
          </div>

          {restoreMutation.isError && (
            <div className="mt-3 text-sm text-red-400">
              Failed to restore snapshot. Please try again.
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
