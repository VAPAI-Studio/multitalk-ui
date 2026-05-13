import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual',
  auto_wizard: 'Before Wizard',
  auto_yolo: 'Before Auto-fill',
  pre_restore: 'Before Restore',
};

interface ComparisonSelectorProps {
  projectId: string;
  side: 'left' | 'right';
  selectedId: string | 'current' | null;
  onSelect: (id: string | 'current') => void;
}

export function ComparisonSelector({
  projectId,
  side,
  selectedId,
  onSelect,
}: ComparisonSelectorProps) {
  const { data: snapshotList } = useQuery({
    queryKey: QUERY_KEYS.SNAPSHOTS(projectId),
    queryFn: () => api.listSnapshots(projectId),
  });

  const snapshots = snapshotList?.items || [];

  return (
    <div>
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
        {side === 'left' ? 'Before' : 'After'}
      </label>
      <select
        value={selectedId || ''}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full text-xs bg-muted/30 border border-border/50 rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-amber-500/40 appearance-none cursor-pointer"
      >
        <option value="" disabled>
          Select...
        </option>
        <option value="current">Current State</option>
        {snapshots.map((s) => {
          const label = s.label || TRIGGER_LABELS[s.trigger_type] || 'Snapshot';
          const date = new Date(s.created_at).toLocaleString();
          const meta = s.metadata
            ? ` (${s.metadata.phase_data_count}p, ${s.metadata.list_item_count}i)`
            : '';
          return (
            <option key={s.id} value={s.id}>
              {label} - {date}{meta}
            </option>
          );
        })}
      </select>
    </div>
  );
}
