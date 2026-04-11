import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ListChecks, Sparkles, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, ROUTES, BREAKDOWN_CATEGORIES } from '../../lib/constants';
import { PhaseNavigation } from '../Workspace/PhaseNavigation';
import { StalenessBar } from './StalenessBar';
import { CategoryTabs } from './CategoryTabs';
import { AddElementDialog } from './AddElementDialog';

export function BreakdownPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const { data: project, isLoading: projectLoading } = useQuery<any>({
    queryKey: QUERY_KEYS.PROJECT_V2(projectId!),
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  const { data: templateConfig } = useQuery({
    queryKey: ['template', project?.template],
    queryFn: () => api.getTemplate(project!.template!),
    enabled: !!project?.template,
  });

  const { data: summary } = useQuery({
    queryKey: QUERY_KEYS.BREAKDOWN_SUMMARY(projectId!),
    queryFn: () => api.getBreakdownSummary(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const extractMutation = useMutation({
    mutationFn: () => api.triggerBreakdownExtraction(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_SUMMARY(projectId!) });
      BREAKDOWN_CATEGORIES.forEach(cat =>
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId!, cat.value) })
      );
    },
  });

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalElements = summary?.total_elements ?? 0;
  const isEmpty = summary !== undefined && totalElements === 0;

  return (
    <div className="flex flex-col h-full bg-background">
      <PhaseNavigation
        phases={templateConfig?.phases ?? []}
        currentPhase=""
        onPhaseChange={(phase) => navigate(ROUTES.PROJECT_WORKSPACE(projectId!, phase))}
        projectTitle={project?.title}
        onBreakdownClick={() => { /* already on breakdown page */ }}
        isBreakdownActive={true}
      />

      {summary?.is_stale && totalElements > 0 && (
        <StalenessBar extractMutation={extractMutation} />
      )}

      {/* Header row with action buttons */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <h2 className="text-sm font-semibold text-foreground">Script Breakdown</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAddDialogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold
              text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/70
              rounded-lg transition-colors border border-border/50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Element
          </button>
          <button
            onClick={() => extractMutation.mutate()}
            disabled={extractMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold
              bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed border border-amber-500/20"
          >
            {extractMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {extractMutation.isPending ? 'Extracting…' : 'Extract Breakdown'}
          </button>
        </div>
      </div>

      {/* Empty state while extracting */}
      {extractMutation.isPending && isEmpty && (
        <div className="flex flex-col items-center justify-center flex-1 py-24 text-center">
          <Loader2 className="h-8 w-8 text-amber-400 animate-spin mb-4" />
          <p className="text-sm text-muted-foreground">Extracting breakdown elements…</p>
          <p className="text-xs text-muted-foreground/60 mt-1">This may take 10–15 seconds.</p>
        </div>
      )}

      {/* Empty state CTA */}
      {isEmpty && !extractMutation.isPending && (
        <div className="flex flex-col items-center justify-center flex-1 py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-5">
            <ListChecks className="h-8 w-8 text-amber-500/60" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No breakdown yet</h3>
          <p className="text-sm text-muted-foreground max-w-xs mb-6">
            Extract production elements from your screenplay — characters, locations, props, wardrobe, and vehicles.
          </p>
          <button
            onClick={() => extractMutation.mutate()}
            disabled={extractMutation.isPending}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold
              bg-amber-500 hover:bg-amber-400 text-white rounded-lg transition-colors
              disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Sparkles className="h-4 w-4" />
            Extract Breakdown
          </button>
        </div>
      )}

      {/* Category tabs — only show when elements exist */}
      {!isEmpty && !extractMutation.isPending && (
        <CategoryTabs
          projectId={projectId!}
          summary={summary}
          extractMutation={extractMutation}
        />
      )}

      {/* Also show tabs while re-extracting (not first-time) */}
      {!isEmpty && extractMutation.isPending && (
        <CategoryTabs
          projectId={projectId!}
          summary={summary}
          extractMutation={extractMutation}
        />
      )}

      <AddElementDialog
        projectId={projectId!}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
    </div>
  );
}
