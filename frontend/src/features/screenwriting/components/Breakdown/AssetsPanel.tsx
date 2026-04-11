import { useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Sparkles, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { BREAKDOWN_CATEGORIES, QUERY_KEYS } from '../../lib/constants';
import type { BreakdownElement } from '../../types';
import { AssetElementCard } from './AssetElementCard';

interface AssetsPanelProps {
  projectId: string;
}

export function AssetsPanel({ projectId }: AssetsPanelProps) {
  const queryClient = useQueryClient();

  const extractMutation = useMutation({
    mutationFn: () => api.triggerBreakdownExtraction(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId) });
    },
  });

  // Audio overlap prevention (MDIA-04)
  const stopCurrentAudioRef = useRef<(() => void) | null>(null);

  const handlePlaybackStart = useCallback((_mediaId: string, stopFn: () => void) => {
    if (stopCurrentAudioRef.current) {
      stopCurrentAudioRef.current();
    }
    stopCurrentAudioRef.current = stopFn;
  }, []);

  const { data: allElements = [] } = useQuery<BreakdownElement[]>({
    queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId),
    queryFn: () => api.getBreakdownElements(projectId),
  });

  const groupedCategories = BREAKDOWN_CATEGORIES
    .map(cat => ({
      ...cat,
      elements: allElements.filter(el => el.category === cat.value),
    }))
    .filter(cat => cat.elements.length > 0);

  if (groupedCategories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <FileText className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-semibold text-foreground">No breakdown elements</p>
        <p className="text-xs text-muted-foreground mb-2">
          Extract characters, locations, props, wardrobe, and vehicles from your screenplay.
        </p>
        <button
          onClick={() => extractMutation.mutate()}
          disabled={extractMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold
            bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed border border-primary/20"
        >
          {extractMutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Sparkles className="h-3.5 w-3.5" />}
          {extractMutation.isPending ? 'Extracting…' : 'Extract Breakdown'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end px-3 py-2 border-b border-border flex-shrink-0">
        <button
          onClick={() => extractMutation.mutate()}
          disabled={extractMutation.isPending}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold
            bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed border border-primary/20"
        >
          {extractMutation.isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Sparkles className="h-3 w-3" />}
          {extractMutation.isPending ? 'Extracting…' : 'Re-extract'}
        </button>
      </div>
      <div className="overflow-y-auto flex-1">
        {groupedCategories.map(cat => (
          <div key={cat.value}>
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 border-b border-border bg-card/30">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {cat.label}
              </span>
              <span className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded-full tabular-nums text-muted-foreground">
                {cat.elements.length}
              </span>
            </div>
            <div className="px-2 py-2 space-y-1.5">
              {cat.elements.map(element => (
                <AssetElementCard
                  key={element.id}
                  element={element}
                  projectId={projectId}
                  onPlaybackStart={handlePlaybackStart}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
