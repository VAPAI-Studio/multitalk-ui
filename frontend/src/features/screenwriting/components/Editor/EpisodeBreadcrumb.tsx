import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, ROUTES } from '../../lib/constants';

interface EpisodeBreadcrumbProps {
  showId: string;
  episodeNumber: number;
  episodeTitle: string;
}

export function EpisodeBreadcrumb({ showId, episodeNumber, episodeTitle }: EpisodeBreadcrumbProps) {
  const { data: show, isLoading, isError } = useQuery({
    queryKey: QUERY_KEYS.SHOW(showId),
    queryFn: () => api.getShow(showId),
    staleTime: Infinity,
  });

  const showLabel = isLoading
    ? <span className="text-muted-foreground/40 animate-pulse">...</span>
    : isError
      ? 'Show'
      : show?.title ?? 'Show';

  return (
    <div className="flex items-center gap-1.5 px-6 py-1.5 border-b border-border/60 bg-card/30 text-sm">
      <Link
        to={ROUTES.SHOW(showId)}
        className="text-indigo-400 hover:text-indigo-300 transition-colors truncate max-w-[200px]"
      >
        {showLabel}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
      <span className="text-muted-foreground truncate">
        Episode {episodeNumber}: {episodeTitle}
      </span>
    </div>
  );
}
