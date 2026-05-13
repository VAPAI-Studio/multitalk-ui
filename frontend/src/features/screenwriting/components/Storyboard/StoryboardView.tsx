// frontend/src/components/Storyboard/StoryboardView.tsx

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Film, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { EpisodeBreadcrumb } from '../Editor/EpisodeBreadcrumb';
import { ShotCard } from './ShotCard';
import { FrameGalleryModal } from './FrameGalleryModal';
import type { Shot } from '../../types';

const STYLE_OPTIONS = [
  { value: 'photorealistic', label: 'Photorealistic' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'animated', label: 'Animated' },
] as const;

interface StoryboardViewProps {
  projectId: string;
}

interface SceneGroup {
  sceneItemId: string | null;
  sceneLabel: string;
  shots: Shot[];
}

function groupShotsByScene(shots: Shot[]): SceneGroup[] {
  const groups = new Map<string, Shot[]>();
  const groupOrder: string[] = [];

  for (const shot of shots) {
    const key = shot.scene_item_id ?? 'unassigned';
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(shot);
  }

  // Move unassigned to end
  const unassignedIdx = groupOrder.indexOf('unassigned');
  if (unassignedIdx >= 0 && unassignedIdx < groupOrder.length - 1) {
    groupOrder.splice(unassignedIdx, 1);
    groupOrder.push('unassigned');
  }

  return groupOrder.map((key, index) => ({
    sceneItemId: key === 'unassigned' ? null : key,
    sceneLabel: key === 'unassigned' ? 'Unassigned Shots' : `Scene ${index + 1}`,
    shots: groups.get(key)!,
  }));
}

export function StoryboardView({ projectId }: StoryboardViewProps) {
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: project } = useQuery({
    queryKey: QUERY_KEYS.PROJECT(projectId),
    queryFn: () => api.getProject(projectId),
  });

  const styleMutation = useMutation({
    mutationFn: (style: string) => api.updateProject(projectId, { storyboard_style: style }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROJECT(projectId) });
    },
  });

  const isEpisode = !!project?.show_id && project?.episode_number != null;

  // Apply storyboard CSS theme — remove on unmount
  useEffect(() => {
    document.documentElement.classList.add('storyboard-mode');
    return () => {
      document.documentElement.classList.remove('storyboard-mode');
    };
  }, []);

  const { data: shots, isLoading, isError, error, refetch } = useQuery<Shot[]>({
    queryKey: QUERY_KEYS.SHOTS(projectId),
    queryFn: () => api.listShots(projectId),
    staleTime: 30_000,
  });

  let contentJsx: React.ReactNode;

  if (isLoading) {
    contentJsx = (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
        <p className="text-sm">Loading storyboard...</p>
      </div>
    );
  } else if (isError) {
    contentJsx = (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
        <AlertCircle className="h-8 w-8 text-destructive/60" />
        <p className="text-sm">Failed to load shots</p>
        <p className="text-xs text-muted-foreground/60">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <button
          onClick={() => refetch()}
          className="text-xs px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  } else if (!shots || shots.length === 0) {
    contentJsx = (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground">
        <Film className="h-12 w-12 opacity-30" />
        <p className="text-lg font-medium">No shots yet</p>
        <p className="text-sm opacity-60 text-center max-w-xs">
          Create shots in Script Breakdown mode, then come here to build your storyboard.
        </p>
      </div>
    );
  } else {
    const groups = groupShotsByScene(shots);

    const selectedShot = selectedShotId
      ? shots.find(s => s.id === selectedShotId) ?? null
      : null;

    const selectedShotSceneLabel = selectedShot
      ? (groups.find(g => g.shots.some(s => s.id === selectedShotId))?.sceneLabel ?? '')
      : '';

    contentJsx = (
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {groups.map((group) => (
          <div key={group.sceneItemId ?? 'unassigned'}>
            {/* Scene header */}
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-sm font-semibold text-foreground">{group.sceneLabel}</h3>
              <span className="text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full">
                {group.shots.length} shot{group.shots.length !== 1 ? 's' : ''}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
            {/* Shot card grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {group.shots
                .sort((a, b) => a.sort_order - b.sort_order || a.shot_number - b.shot_number)
                .map((shot) => (
                  <ShotCard
                    key={shot.id}
                    shot={shot}
                    projectId={projectId}
                    sceneLabel={group.sceneLabel}
                    onClick={setSelectedShotId}
                  />
                ))}
            </div>
          </div>
        ))}
        {selectedShot && (
          <FrameGalleryModal
            shot={selectedShot}
            projectId={projectId}
            sceneLabel={selectedShotSceneLabel}
            open={!!selectedShotId}
            onOpenChange={(open) => {
              if (!open) setSelectedShotId(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <>
      {isEpisode && (
        <EpisodeBreadcrumb
          showId={project!.show_id!}
          episodeNumber={project!.episode_number!}
          episodeTitle={project!.title}
        />
      )}
      <div className={`flex flex-col ${isEpisode ? 'h-[calc(100vh-89px)]' : 'h-[calc(100vh-3.5rem)]'}`}>
      {/* Storyboard header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Storyboard
        </span>
        <div className="flex items-center gap-3">
          <select
            value={project?.storyboard_style ?? 'cinematic'}
            onChange={(e) => styleMutation.mutate(e.target.value)}
            disabled={styleMutation.isPending}
            className="text-[10px] bg-muted/60 text-muted-foreground border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary/40"
          >
            {STYLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground">
            {shots?.length ?? 0} shots
          </span>
        </div>
      </div>
      {/* Content area */}
      {contentJsx}
    </div>
    </>
  );
}
