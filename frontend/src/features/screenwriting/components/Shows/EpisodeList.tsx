import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Loader2, Film } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, ROUTES } from '../../lib/constants';
import { FRAMEWORK_LABELS } from '../../lib/section-config';
import { Button } from '../UI/Button';
import { CreateEpisodeModal } from './CreateEpisodeModal';

interface EpisodeListProps {
  showId: string;
}

export function EpisodeList({ showId }: EpisodeListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: episodes = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.EPISODES(showId),
    queryFn: () => api.getEpisodes(showId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.EPISODES(showId) });
    },
  });

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('Delete this episode? This cannot be undone.')) {
      deleteMutation.mutate(id);
    }
  };

  const nextEpisodeNumber = episodes.length > 0
    ? Math.max(...episodes.map(ep => ep.episode_number ?? 0)) + 1
    : 1;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {/* Header with New Episode button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{episodes.length} episode{episodes.length !== 1 ? 's' : ''}</span>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          New Episode
        </Button>
      </div>

      {/* Episode list or empty state */}
      {episodes.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-xl">
          <Film className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No episodes yet — create your first episode</p>
        </div>
      ) : (
        <div className="space-y-1">
          {episodes.map((episode) => (
            <button
              key={episode.id}
              onClick={() => navigate(ROUTES.PROJECT(episode.id))}
              className="group w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 transition-all text-left"
            >
              {/* Episode number */}
              <span className="flex-shrink-0 text-sm font-medium text-indigo-400 w-12">
                Ep. {episode.episode_number}
              </span>

              {/* Title */}
              <span className="flex-1 text-sm text-foreground truncate">
                {episode.title}
              </span>

              {/* Framework badge */}
              {episode.framework && (
                <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {FRAMEWORK_LABELS[episode.framework]}
                </span>
              )}

              {/* Delete button */}
              <button
                onClick={(e) => handleDelete(e, episode.id)}
                className="flex-shrink-0 p-1.5 text-transparent group-hover:text-muted-foreground hover:!text-destructive rounded-lg transition-colors"
                aria-label={`Delete episode ${episode.episode_number}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </button>
          ))}
        </div>
      )}

      <CreateEpisodeModal
        showId={showId}
        nextEpisodeNumber={nextEpisodeNumber}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </>
  );
}
