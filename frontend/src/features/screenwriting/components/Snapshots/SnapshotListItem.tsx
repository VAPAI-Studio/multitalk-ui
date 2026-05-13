import { ChevronDown, ChevronRight, RotateCcw, Trash2, ArrowLeftRight } from 'lucide-react';
import type { Snapshot } from '../../types';

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual',
  auto_wizard: 'Before Wizard',
  auto_yolo: 'Before Auto-fill',
  pre_restore: 'Before Restore',
};

const TRIGGER_COLORS: Record<string, string> = {
  manual: 'bg-blue-500/20 text-blue-400',
  auto_wizard: 'bg-violet-500/20 text-violet-400',
  auto_yolo: 'bg-amber-500/20 text-amber-400',
  pre_restore: 'bg-slate-500/20 text-slate-400',
};

interface SnapshotListItemProps {
  snapshot: Snapshot;
  isExpanded: boolean;
  onToggle: () => void;
  onRestore: (snapshot: Snapshot) => void;
  onDelete: (snapshotId: string) => void;
  onCompare?: (snapshotId: string) => void;
  children?: React.ReactNode;
}

export function SnapshotListItem({
  snapshot,
  isExpanded,
  onToggle,
  onRestore,
  onDelete,
  onCompare,
  children,
}: SnapshotListItemProps) {
  const label = snapshot.label || TRIGGER_LABELS[snapshot.trigger_type] || 'Snapshot';
  const badgeColor = TRIGGER_COLORS[snapshot.trigger_type] || TRIGGER_COLORS.manual;
  const timestamp = new Date(snapshot.created_at).toLocaleString();

  return (
    <div className="border-b border-border/50">
      <div
        className="px-3 py-2 hover:bg-muted/30 cursor-pointer transition-colors flex items-start gap-2"
        onClick={onToggle}
      >
        <button className="mt-0.5 flex-shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeColor}`}>
              {TRIGGER_LABELS[snapshot.trigger_type] || snapshot.trigger_type}
            </span>
            <span className="text-xs text-foreground truncate">{label}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{timestamp}</div>
          {snapshot.metadata && (
            <div className="text-[10px] text-muted-foreground/60 mt-0.5">
              {snapshot.metadata.phase_data_count} phases, {snapshot.metadata.list_item_count} items
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {onCompare && (
            <button
              onClick={(e) => { e.stopPropagation(); onCompare(snapshot.id); }}
              className="p-1 rounded hover:bg-blue-500/20 text-muted-foreground hover:text-blue-400 transition-colors"
              title="Compare this snapshot"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRestore(snapshot); }}
            className="p-1 rounded hover:bg-amber-500/20 text-muted-foreground hover:text-amber-400 transition-colors"
            title="Restore this snapshot"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(snapshot.id); }}
            className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
            title="Delete this snapshot"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {isExpanded && children}
    </div>
  );
}
