import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { diffStructuredFields } from '../../lib/diff-utils';
import { ComparisonSelector } from './ComparisonSelector';
import { TextDiff } from './TextDiff';
import { FieldDiff } from './FieldDiff';
import type { SnapshotData } from '../../types';

interface ComparisonViewProps {
  projectId: string;
  onClose: () => void;
  initialSnapshotId?: string;
}

function extractData(
  query: { data?: unknown; isLoading: boolean },
  id: string | 'current' | null,
): { data: SnapshotData | undefined; isLoading: boolean } {
  if (!id) return { data: undefined, isLoading: false };
  if (query.isLoading) return { data: undefined, isLoading: true };
  if (id === 'current') {
    return { data: query.data as SnapshotData | undefined, isLoading: false };
  }
  // For snapshots, data is SnapshotDetail which has .data
  const detail = query.data as { data?: SnapshotData } | undefined;
  return { data: detail?.data, isLoading: false };
}

export function ComparisonView({ projectId, onClose, initialSnapshotId }: ComparisonViewProps) {
  const [leftId, setLeftId] = useState<string | 'current' | null>(initialSnapshotId || null);
  const [rightId, setRightId] = useState<string | 'current' | null>(initialSnapshotId ? 'current' : null);

  // Fetch left side
  const leftCurrentQuery = useQuery({
    queryKey: QUERY_KEYS.CURRENT_STATE(projectId),
    queryFn: () => api.getCurrentState(projectId),
    enabled: leftId === 'current',
  });

  const leftSnapshotQuery = useQuery({
    queryKey: QUERY_KEYS.SNAPSHOT(projectId, leftId && leftId !== 'current' ? leftId : '__none__'),
    queryFn: () => api.getSnapshot(projectId, leftId as string),
    enabled: !!leftId && leftId !== 'current',
  });

  // Fetch right side
  const rightCurrentQuery = useQuery({
    queryKey: QUERY_KEYS.CURRENT_STATE(projectId),
    queryFn: () => api.getCurrentState(projectId),
    enabled: rightId === 'current',
  });

  const rightSnapshotQuery = useQuery({
    queryKey: QUERY_KEYS.SNAPSHOT(projectId, rightId && rightId !== 'current' ? rightId : '__none__'),
    queryFn: () => api.getSnapshot(projectId, rightId as string),
    enabled: !!rightId && rightId !== 'current',
  });

  const left = extractData(
    leftId === 'current' ? leftCurrentQuery : leftSnapshotQuery,
    leftId,
  );
  const right = extractData(
    rightId === 'current' ? rightCurrentQuery : rightSnapshotQuery,
    rightId,
  );

  const isLoading = left.isLoading || right.isLoading;
  const bothReady = left.data && right.data;

  // Compute diffs
  const { phaseDiffs, screenplayDiffs, phasesChanged, screenplayChanged } = useMemo(() => {
    if (!left.data || !right.data) {
      return { phaseDiffs: [], screenplayDiffs: [], phasesChanged: 0, screenplayChanged: 0 };
    }

    // Phase diffs: match by phase + subsection_key
    const leftPhaseMap = new Map(
      left.data.phase_data.map((pd) => [`${pd.phase}::${pd.subsection_key}`, pd]),
    );
    const rightPhaseMap = new Map(
      right.data.phase_data.map((pd) => [`${pd.phase}::${pd.subsection_key}`, pd]),
    );

    const allPhaseKeys = new Set([...leftPhaseMap.keys(), ...rightPhaseMap.keys()]);
    let pChanged = 0;

    const pDiffs = Array.from(allPhaseKeys).map((key) => {
      const leftPd = leftPhaseMap.get(key);
      const rightPd = rightPhaseMap.get(key);
      const [phase, subsection] = key.split('::');
      const changes = diffStructuredFields(
        leftPd?.content || {},
        rightPd?.content || {},
      );
      const hasChanges = changes.some((c) => c.changed);
      if (hasChanges) pChanged++;
      return { key, phase, subsection, changes, hasChanges };
    });

    // Screenplay diffs: match by id
    const leftScreenplay = new Map(
      (left.data.screenplay_content || []).map((sc) => [sc.id, sc.content]),
    );
    const rightScreenplay = new Map(
      (right.data.screenplay_content || []).map((sc) => [sc.id, sc.content]),
    );

    const allScreenplayIds = new Set([...leftScreenplay.keys(), ...rightScreenplay.keys()]);
    let sChanged = 0;

    const sDiffs = Array.from(allScreenplayIds).map((id) => {
      const leftContent = leftScreenplay.get(id) || '';
      const rightContent = rightScreenplay.get(id) || '';
      const hasChanges = leftContent !== rightContent;
      if (hasChanges) sChanged++;
      return { id, leftContent, rightContent, hasChanges };
    });

    return {
      phaseDiffs: pDiffs,
      screenplayDiffs: sDiffs,
      phasesChanged: pChanged,
      screenplayChanged: sChanged,
    };
  }, [left.data, right.data]);

  // Label helpers
  const getLabel = (id: string | 'current' | null): string => {
    if (id === 'current') return 'Current';
    if (!id) return 'Not selected';
    return 'Snapshot';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-sm font-semibold text-foreground">Comparing</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Close comparison"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-2 gap-3 px-3 py-2.5 border-b border-border/50">
        <ComparisonSelector
          projectId={projectId}
          side="left"
          selectedId={leftId}
          onSelect={setLeftId}
        />
        <ComparisonSelector
          projectId={projectId}
          side="right"
          selectedId={rightId}
          onSelect={setRightId}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (!leftId || !rightId) && (
          <div className="text-xs text-muted-foreground/50 text-center py-8">
            Select both sides to compare
          </div>
        )}

        {!isLoading && bothReady && (
          <>
            {/* Summary */}
            <div className="text-xs text-muted-foreground mb-4 bg-muted/20 rounded-md px-3 py-2">
              {phasesChanged} phase{phasesChanged !== 1 ? 's' : ''} changed,{' '}
              {screenplayChanged} screenplay entr{screenplayChanged !== 1 ? 'ies' : 'y'} changed
            </div>

            {/* Phase diffs */}
            {phaseDiffs.filter((d) => d.hasChanges).length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-foreground mb-2">Phase Data Changes</div>
                {phaseDiffs
                  .filter((d) => d.hasChanges)
                  .map((diff) => (
                    <FieldDiff
                      key={diff.key}
                      changes={diff.changes}
                      phaseName={`${diff.phase} / ${diff.subsection}`}
                    />
                  ))}
              </div>
            )}

            {/* Screenplay diffs */}
            {screenplayDiffs.filter((d) => d.hasChanges).length > 0 && (
              <div>
                <div className="text-xs font-semibold text-foreground mb-2">Screenplay Changes</div>
                {screenplayDiffs
                  .filter((d) => d.hasChanges)
                  .map((diff) => (
                    <div key={diff.id} className="mb-4">
                      <TextDiff
                        before={diff.leftContent}
                        after={diff.rightContent}
                        beforeLabel={getLabel(leftId)}
                        afterLabel={getLabel(rightId)}
                      />
                    </div>
                  ))}
              </div>
            )}

            {phasesChanged === 0 && screenplayChanged === 0 && (
              <div className="text-xs text-muted-foreground/50 text-center py-8">
                No differences found between the selected states.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
