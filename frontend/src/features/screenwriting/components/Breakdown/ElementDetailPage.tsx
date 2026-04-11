import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, ROUTES, BREAKDOWN_CATEGORIES } from '../../lib/constants';
import { ElementExtendedFields } from './ElementExtendedFields';
import { ElementSceneList } from './ElementSceneList';
import { ReferenceImageGallery } from './ReferenceImageGallery';
import type { BreakdownElementUpdate } from '../../types';

interface ElementDetailPageProps {
  projectId: string;
  elementId: string;
}

export function ElementDetailPage({ projectId, elementId }: ElementDetailPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: element, isLoading, isError } = useQuery({
    queryKey: QUERY_KEYS.BREAKDOWN_ELEMENT(elementId),
    queryFn: () => api.getBreakdownElement(elementId),
  });

  const updateMutation = useMutation({
    mutationFn: (data: BreakdownElementUpdate) =>
      api.updateBreakdownElement(elementId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_ELEMENT(elementId) });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId) });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !element) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <button
          onClick={() => navigate(ROUTES.PROJECT_BREAKDOWN(projectId))}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Breakdown
        </button>
        <p className="text-muted-foreground">Element not found.</p>
      </div>
    );
  }

  const categoryLabel = BREAKDOWN_CATEGORIES.find(
    (c) => c.value === element.category
  )?.label || element.category;

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Back button */}
      <button
        onClick={() => navigate(ROUTES.PROJECT_BREAKDOWN(projectId))}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Breakdown
      </button>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold text-foreground">{element.name}</h1>
          <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 ml-3">
            {categoryLabel}
          </span>
          <span
            className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ml-2 ${
              element.source === 'ai'
                ? 'bg-blue-500/10 text-blue-400'
                : 'bg-emerald-500/10 text-emerald-400'
            }`}
          >
            {element.source === 'ai' ? 'AI' : 'User'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          {element.description || 'No description'}
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-8">
          {/* Extended Fields */}
          <ElementExtendedFields
            element={element}
            onSave={(data) => updateMutation.mutate(data)}
            isSaving={updateMutation.isPending}
          />

          {/* Scene Appearances */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              Scene Appearances
            </h3>
            <ElementSceneList sceneLinks={element.scene_links} projectId={projectId} />
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-1">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Reference Images
          </h3>
          <ReferenceImageGallery projectId={projectId} elementId={elementId} />
        </div>
      </div>
    </div>
  );
}
