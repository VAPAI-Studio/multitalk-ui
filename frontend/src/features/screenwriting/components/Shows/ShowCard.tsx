import { Clock, Trash2, Tv } from 'lucide-react';
import { type Show } from '../../types';

interface ShowCardProps {
  show: Show;
  onDelete?: (id: string) => void;
}

export function ShowCard({ show, onDelete }: ShowCardProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="group relative bg-card border border-border rounded-xl p-5 transition-all duration-300 hover:border-amber-500/20 hover:glow-amber">
      {/* Accent gradient at top */}
      <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r from-indigo-500/20 to-violet-500/20 border-indigo-500/20" />

      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <Tv className="h-4 w-4 text-indigo-400 flex-shrink-0" />
          <h3 className="text-base font-semibold text-foreground truncate group-hover:text-amber-100 transition-colors">
            {show.title}
          </h3>
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(show.id);
            }}
            className="p-1.5 text-transparent group-hover:text-muted-foreground hover:!text-destructive rounded-lg transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
        {show.description || 'No description'}
      </p>

      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatDate(show.created_at)}
        </div>

        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          0 episodes
        </span>
      </div>
    </div>
  );
}
