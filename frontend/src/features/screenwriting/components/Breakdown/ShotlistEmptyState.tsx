import { List, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '../UI/Button';

interface ShotlistEmptyStateProps {
  onAddShot: () => void;
  isPending: boolean;
  onGenerate?: () => void;
  isGenerating?: boolean;
  generateError?: string | null;
}

export function ShotlistEmptyState({ onAddShot, isPending, onGenerate, isGenerating, generateError }: ShotlistEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 animate-fade-in">
      <List className="h-10 w-10 text-muted-foreground/30" />
      <div className="text-center max-w-xs">
        <p className="text-sm font-semibold text-foreground">No shots yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create your first shot to start building your shotlist.
        </p>
      </div>
      <Button
        onClick={onAddShot}
        disabled={isPending}
        className="mt-4"
      >
        Add First Shot
      </Button>
      {onGenerate && (
        <Button
          onClick={onGenerate}
          disabled={isGenerating}
          variant="outline"
          className="mt-2"
        >
          {isGenerating
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Generating...</>
            : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate with AI</>}
        </Button>
      )}
      {generateError && (
        <p className="text-xs text-destructive mt-2">{generateError}</p>
      )}
    </div>
  );
}
