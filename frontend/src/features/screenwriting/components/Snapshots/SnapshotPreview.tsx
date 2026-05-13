import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';

interface SnapshotPreviewProps {
  projectId: string;
  snapshotId: string;
  isVisible: boolean;
}

export function SnapshotPreview({ projectId, snapshotId, isVisible }: SnapshotPreviewProps) {
  const { data: detail, isLoading } = useQuery({
    queryKey: QUERY_KEYS.SNAPSHOT(projectId, snapshotId),
    queryFn: () => api.getSnapshot(projectId, snapshotId),
    enabled: isVisible,
    staleTime: 5 * 60 * 1000,
  });

  if (!isVisible) return null;

  if (isLoading) {
    return (
      <div className="bg-muted/20 rounded-md p-3 mx-3 mb-2 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) return null;

  const { phase_data, screenplay_content } = detail.data;

  return (
    <div className="bg-muted/20 rounded-md p-3 mx-3 mb-2 text-sm space-y-2">
      {phase_data.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Phase Data ({phase_data.length})</div>
          {phase_data.map((pd) => (
            <div key={pd.id} className="text-[11px] text-foreground/70 pl-2 border-l border-border/40 mb-1">
              <span className="font-medium">{pd.phase}</span>
              <span className="text-muted-foreground"> / {pd.subsection_key}</span>
              {pd.list_items.length > 0 && (
                <span className="text-muted-foreground/60"> ({pd.list_items.length} items)</span>
              )}
              <div className="text-[10px] text-muted-foreground/50 truncate">
                {JSON.stringify(pd.content).slice(0, 100)}...
              </div>
            </div>
          ))}
        </div>
      )}

      {screenplay_content && screenplay_content.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">
            Screenplay ({screenplay_content.length})
          </div>
          {screenplay_content.map((sc) => (
            <div key={sc.id} className="text-[10px] text-muted-foreground/50 truncate pl-2 border-l border-border/40">
              {sc.content.slice(0, 100)}...
            </div>
          ))}
        </div>
      )}

      {phase_data.length === 0 && (!screenplay_content || screenplay_content.length === 0) && (
        <div className="text-xs text-muted-foreground/50 italic">Empty snapshot</div>
      )}
    </div>
  );
}
