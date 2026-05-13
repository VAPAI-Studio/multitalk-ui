import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { BreakdownElement, BreakdownRun } from '../../types';
import { ElementCard } from './ElementCard';

interface ElementListProps {
  projectId: string;
  category: string;
  isActive: boolean;
  extractMutation: UseMutationResult<BreakdownRun, Error, void, unknown>;
}

export function ElementList({ projectId, category, isActive }: ElementListProps) {
  const queryClient = useQueryClient();
  void queryClient;

  const { data: elements, isLoading } = useQuery<BreakdownElement[]>({
    queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category),
    queryFn: () => api.getBreakdownElements(projectId, category),
    enabled: !!projectId && isActive,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="px-6 py-4 space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-lg bg-muted/20 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!elements || elements.length === 0) {
    return (
      <p className="text-sm text-muted-foreground px-6 py-12 text-center">
        No {category} elements yet.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border/50 px-6 py-4 space-y-2">
      {elements.map(element => (
        <ElementCard
          key={element.id}
          element={element}
          projectId={projectId}
          category={category}
        />
      ))}
    </div>
  );
}
