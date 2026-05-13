// frontend/src/components/Storyboard/ShotCard.tsx

import { useQuery } from '@tanstack/react-query';
import { Image, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { Shot, StoryboardFrame } from '../../types';

interface ShotCardProps {
  shot: Shot;
  projectId: string;
  sceneLabel: string;
  onClick: (shotId: string) => void;
}

export function ShotCard({ shot, projectId, sceneLabel, onClick }: ShotCardProps) {
  const { data: frames = [] } = useQuery<StoryboardFrame[]>({
    queryKey: QUERY_KEYS.STORYBOARD_FRAMES(shot.id),
    queryFn: () => api.listFrames(projectId, shot.id),
    staleTime: 60_000,
  });

  const selectedFrame = frames.find(f => f.is_selected) ?? frames[0] ?? null;

  const desc = shot.fields.description ?? '';
  const truncatedDesc = desc.length > 60 ? desc.slice(0, 57) + '...' : desc;

  return (
    <button
      onClick={() => onClick(shot.id)}
      className="group cursor-pointer rounded-lg border border-border bg-card
        hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5
        transition-all duration-200 overflow-hidden text-left w-full"
    >
      {/* Frame area */}
      <div className="aspect-video w-full bg-muted/30 relative overflow-hidden">
        {selectedFrame ? (
          <>
            <img
              src={selectedFrame.thumbnail_path ?? selectedFrame.file_path}
              alt="Shot frame"
              className="w-full h-full object-cover"
            />
            {selectedFrame.generation_source === 'ai' && (
              <div className="absolute top-1.5 right-1.5 bg-primary/80 text-primary-foreground rounded p-0.5">
                <Sparkles className="h-3 w-3" />
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            <Image className="h-8 w-8 text-muted-foreground/30" />
          </div>
        )}
        {frames.length > 1 && (
          <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded-full">
            {frames.length} frames
          </span>
        )}
      </div>

      {/* Info area */}
      <div className="p-2.5 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/70">
            {sceneLabel}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            #{shot.shot_number}
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
          {truncatedDesc || 'No description'}
        </p>
        {shot.fields.shot_size && (
          <span className="inline-block text-[10px] bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded mt-1">
            {shot.fields.shot_size}
          </span>
        )}
      </div>
    </button>
  );
}
