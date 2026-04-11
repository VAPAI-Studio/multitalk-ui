import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Tv, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { BibleEditor } from './BibleEditor';
import { EpisodeList } from './EpisodeList';

interface ShowDetailProps {
  showId: string;
}

export function ShowDetail({ showId }: ShowDetailProps) {
  const navigate = useNavigate();

  const { data: show, isLoading: showLoading, isError: showError } = useQuery({
    queryKey: QUERY_KEYS.SHOW(showId),
    queryFn: () => api.getShow(showId),
  });

  const { data: bible, isLoading: bibleLoading } = useQuery({
    queryKey: QUERY_KEYS.BIBLE(showId),
    queryFn: () => api.getBible(showId),
  });

  const isLoading = showLoading || bibleLoading;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        <p className="text-sm text-muted-foreground">Loading show...</p>
      </div>
    );
  }

  if (showError || !show) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-sm text-muted-foreground">Failed to load show.</p>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-amber-400 hover:text-amber-300 transition-colors"
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-10 animate-fade-in">
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Home
      </button>

      {/* Show header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-500/15 flex items-center justify-center">
          <Tv className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
            {show.title}
          </h1>
          {show.description && (
            <p className="text-muted-foreground mt-1">{show.description}</p>
          )}
        </div>
      </div>

      {/* Series Bible */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-foreground mb-4">Series Bible</h2>
        {bible && <BibleEditor showId={showId} bible={bible} />}
      </section>

      {/* Episode List */}
      <section>
        <h2 className="text-xl font-semibold text-foreground mb-4">Episodes</h2>
        <EpisodeList showId={showId} />
      </section>
    </div>
  );
}
