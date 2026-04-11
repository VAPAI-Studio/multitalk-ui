import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { SelectionBar } from './SelectionBar';
import { HighlightedScriptText } from './HighlightedScriptText';
import type { ShotCreate, Shot } from '../../types';

interface ScriptReadViewProps {
  projectId: string;
  hoveredShotId?: string | null;
}

// ============================================================
// Selection helpers
// ============================================================

interface SelectionState {
  text: string;
  lineCount: number;
  rect: DOMRect;
  sceneItemId: string | null;
}

function getSceneIdFromSelection(selection: Selection): string | null {
  const anchorNode = selection.anchorNode;
  if (!anchorNode) return null;
  const el =
    anchorNode.nodeType === Node.ELEMENT_NODE
      ? (anchorNode as Element)
      : anchorNode.parentElement;
  const sceneEl = el?.closest('[data-scene-id]');
  const id = sceneEl?.getAttribute('data-scene-id');
  return id || null;
}

// ============================================================
// ScriptReadView
// ============================================================

export function ScriptReadView({ projectId, hoveredShotId }: ScriptReadViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectionState, setSelectionState] = useState<SelectionState | null>(null);
  const queryClient = useQueryClient();

  // 1. Screenplay content
  const { data: screenplayData, isLoading: screenplayLoading } = useQuery({
    queryKey: QUERY_KEYS.SUBSECTION_DATA(projectId, 'write', 'screenplay_editor'),
    queryFn: () => api.getSubsectionData(projectId, 'write', 'screenplay_editor'),
    enabled: !!projectId,
  });

  // 2. Scene phase data (to get the phase_data ID for scene_list)
  const { data: scenePhaseData } = useQuery({
    queryKey: QUERY_KEYS.PHASE_DATA(projectId, 'scenes'),
    queryFn: () => api.getPhaseData(projectId, 'scenes'),
    enabled: !!projectId,
  });
  const sceneListPD = scenePhaseData?.find(pd => pd.subsection_key === 'scene_list');

  // 3. Scene list items (to get scene IDs and titles)
  const { data: sceneItems } = useQuery({
    queryKey: QUERY_KEYS.LIST_ITEMS(sceneListPD?.id ?? ''),
    queryFn: () => api.getListItems(sceneListPD!.id),
    enabled: !!sceneListPD?.id,
  });

  // 4. Existing shots (to calculate shot_number and sort_order for new shots)
  const { data: shots } = useQuery({
    queryKey: QUERY_KEYS.SHOTS(projectId),
    queryFn: () => api.listShots(projectId),
    enabled: !!projectId,
  });

  // 5. Breakdown elements (for highlighting in script text)
  const { data: allElements } = useQuery({
    queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId),
    queryFn: () => api.getBreakdownElements(projectId),
    enabled: !!projectId,
  });

  // Extract screenplays
  const screenplays: Array<{ episode_index: number; title: string; content: string }> =
    (screenplayData?.content as any)?.screenplays ?? [];

  // Create shot mutation
  const createMutation = useMutation({
    mutationFn: (data: ShotCreate) => api.createShot(projectId, data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SHOTS(projectId) });
    },
  });

  // ---- Text selection detection ----
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionState(null);
        return;
      }

      const range = selection.getRangeAt(0);
      if (!containerRef.current?.contains(range.commonAncestorContainer)) {
        setSelectionState(null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        setSelectionState(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      const lineCount = text.split('\n').filter(l => l.trim()).length;
      const sceneItemId = getSceneIdFromSelection(selection);

      setSelectionState({ text, lineCount, rect, sceneItemId });
    };

    // Primary listener
    document.addEventListener('selectionchange', handleSelectionChange);

    // Safari fallback
    const container = containerRef.current;
    container?.addEventListener('mouseup', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      container?.removeEventListener('mouseup', handleSelectionChange);
    };
  }, []);

  // ---- Add Shot handler ----
  const handleAddShotFromSelection = useCallback(() => {
    if (!selectionState) return;
    const { text, sceneItemId } = selectionState;

    const groupShots = (shots ?? []).filter((s: Shot) =>
      sceneItemId === null
        ? s.scene_item_id === null
        : s.scene_item_id === sceneItemId
    );
    const maxNumber = groupShots.reduce((max: number, s: Shot) => Math.max(max, s.shot_number), 0);
    const maxSortOrder = groupShots.reduce((max: number, s: Shot) => Math.max(max, s.sort_order), -1);

    createMutation.mutate({
      scene_item_id: sceneItemId,
      shot_number: maxNumber + 1,
      script_text: text,
      sort_order: maxSortOrder + 1,
      source: 'user',
    });

    window.getSelection()?.removeAllRanges();
    setSelectionState(null);
  }, [selectionState, shots, createMutation]);

  // ---- Dismiss handler ----
  const handleDismissSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelectionState(null);
  }, []);

  // ---- Loading state ----
  if (screenplayLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-3">
        <div className="h-4 w-32 rounded bg-muted/20 animate-pulse" />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-3 rounded bg-muted/20 animate-pulse" style={{ width: `${70 + Math.random() * 30}%` }} />
        ))}
        <div className="h-4 w-32 rounded bg-muted/20 animate-pulse mt-4" />
        {[...Array(6)].map((_, i) => (
          <div key={`b-${i}`} className="h-3 rounded bg-muted/20 animate-pulse" style={{ width: `${70 + Math.random() * 30}%` }} />
        ))}
      </div>
    );
  }

  // ---- Empty state ----
  if (!screenplays.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <FileText className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No screenplay content yet</p>
        <p className="text-xs text-muted-foreground/60">
          Switch to Script mode and generate a script to see it here.
        </p>
      </div>
    );
  }

  // ---- Data state ----
  return (
    <div ref={containerRef} className="flex-1 overflow-auto">
      {screenplays.map((sp, idx) => {
        const sceneItem = sceneItems?.find(si => si.sort_order === idx) ?? sceneItems?.[idx];
        return (
          <div key={idx} data-scene-id={sceneItem?.id ?? ''} className="mb-6 px-4">
            <div
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 py-2 sticky top-0 bg-background/95 backdrop-blur-sm"
              style={{ borderBottom: '1px solid hsl(var(--border))' }}
            >
              {sp.title || sceneItem?.content?.title || `Scene ${idx + 1}`}
            </div>
            <pre className="text-[13px] text-foreground/90 whitespace-pre-wrap break-words leading-relaxed font-mono">
              <HighlightedScriptText
                text={sp.content}
                elements={allElements ?? []}
                projectId={projectId}
                shots={shots ?? []}
                hoveredShotId={hoveredShotId}
              />
            </pre>
          </div>
        );
      })}

      {selectionState && (
        <SelectionBar
          rect={selectionState.rect}
          lineCount={selectionState.lineCount}
          onAddShot={handleAddShotFromSelection}
          onDismiss={handleDismissSelection}
          isPending={createMutation.isPending}
        />
      )}
    </div>
  );
}
