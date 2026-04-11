import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Loader2, History, ArrowLeftRight } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { ResizablePanel } from '../UI/ResizablePanel';
import { SnapshotListItem } from './SnapshotListItem';
import { SnapshotPreview } from './SnapshotPreview';
import { RestoreConfirmationModal } from './RestoreConfirmationModal';
import { ComparisonView } from './ComparisonView';
import type { Snapshot, SnapshotDetail } from '../../types';

interface SnapshotPanelProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function SnapshotPanel({ projectId, isOpen, onClose }: SnapshotPanelProps) {
  const queryClient = useQueryClient();
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Snapshot | null>(null);
  const [restoreDetail, setRestoreDetail] = useState<SnapshotDetail | undefined>(undefined);
  const [createLabel, setCreateLabel] = useState('');
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonSnapshotId, setComparisonSnapshotId] = useState<string | undefined>(undefined);

  // List snapshots
  const { data: snapshotList, isLoading } = useQuery({
    queryKey: QUERY_KEYS.SNAPSHOTS(projectId),
    queryFn: () => api.listSnapshots(projectId),
    enabled: isOpen,
  });

  // Create snapshot mutation
  const createMutation = useMutation({
    mutationFn: (label?: string) => api.createSnapshot(projectId, label),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SNAPSHOTS(projectId) });
      setCreateLabel('');
      setShowCreateInput(false);
    },
  });

  // Delete snapshot mutation
  const deleteMutation = useMutation({
    mutationFn: (snapshotId: string) => api.deleteSnapshot(projectId, snapshotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SNAPSHOTS(projectId) });
    },
  });

  const handleToggleExpand = (snapshotId: string) => {
    setExpandedSnapshotId((prev) => (prev === snapshotId ? null : snapshotId));
  };

  const handleRestore = async (snapshot: Snapshot) => {
    setRestoreTarget(snapshot);
    try {
      const detail = await api.getSnapshot(projectId, snapshot.id);
      setRestoreDetail(detail);
    } catch {
      setRestoreDetail(undefined);
    }
  };

  const handleDelete = (snapshotId: string) => {
    if (window.confirm('Delete this snapshot? This cannot be undone.')) {
      deleteMutation.mutate(snapshotId);
    }
  };

  const handleCreate = () => {
    createMutation.mutate(createLabel || undefined);
  };

  const handleCompare = (snapshotId: string) => {
    setComparisonSnapshotId(snapshotId);
    setComparisonMode(true);
  };

  const handleExitComparison = () => {
    setComparisonMode(false);
    setComparisonSnapshotId(undefined);
  };

  if (!isOpen) return null;

  const snapshots = snapshotList?.items || [];

  return (
    <ResizablePanel
      defaultWidth={comparisonMode ? 500 : 340}
      minWidth={300}
      maxWidth={700}
      storageKey="snapshot-panel-width"
      className="border-l border-border bg-card/50"
    >
      {comparisonMode ? (
        <ComparisonView
          projectId={projectId}
          onClose={handleExitComparison}
          initialSnapshotId={comparisonSnapshotId}
        />
      ) : (
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-semibold text-foreground">History</span>
              {snapshotList && (
                <span className="text-[10px] text-muted-foreground/60">({snapshotList.total})</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setComparisonSnapshotId(undefined); setComparisonMode(true); }}
                className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Compare snapshots"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowCreateInput((prev) => !prev)}
                className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Create snapshot"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Close panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Create snapshot input */}
          {showCreateInput && (
            <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
              <input
                type="text"
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                placeholder="Label (optional)"
                className="flex-1 text-xs bg-muted/30 border border-border/50 rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-amber-500/40"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="text-xs px-2.5 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </button>
            </div>
          )}

          {/* Snapshot list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <History className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground/60">No snapshots yet</p>
                <p className="text-xs text-muted-foreground/40 mt-1">
                  Snapshots are created automatically before wizard runs and auto-fills, or you can create one manually.
                </p>
              </div>
            ) : (
              snapshots.map((snapshot) => (
                <SnapshotListItem
                  key={snapshot.id}
                  snapshot={snapshot}
                  isExpanded={expandedSnapshotId === snapshot.id}
                  onToggle={() => handleToggleExpand(snapshot.id)}
                  onRestore={handleRestore}
                  onDelete={handleDelete}
                  onCompare={handleCompare}
                >
                  <SnapshotPreview
                    projectId={projectId}
                    snapshotId={snapshot.id}
                    isVisible={expandedSnapshotId === snapshot.id}
                  />
                </SnapshotListItem>
              ))
            )}
          </div>
        </div>
      )}

      {/* Restore confirmation modal */}
      {restoreTarget && (
        <RestoreConfirmationModal
          open={!!restoreTarget}
          onClose={() => { setRestoreTarget(null); setRestoreDetail(undefined); }}
          projectId={projectId}
          snapshot={restoreTarget}
          snapshotDetail={restoreDetail}
        />
      )}
    </ResizablePanel>
  );
}
