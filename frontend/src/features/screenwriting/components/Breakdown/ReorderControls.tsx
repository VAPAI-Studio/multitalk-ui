import { ChevronUp, ChevronDown } from 'lucide-react';

interface ReorderControlsProps {
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  isPending: boolean;
}

export function ReorderControls({ onMoveUp, onMoveDown, isFirst, isLast, isPending }: ReorderControlsProps) {
  return (
    <div className="flex flex-col items-center">
      <button
        onClick={onMoveUp}
        disabled={isFirst || isPending}
        className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground
          disabled:opacity-30 disabled:cursor-default transition-colors rounded"
        aria-label="Move shot up"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onMoveDown}
        disabled={isLast || isPending}
        className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground
          disabled:opacity-30 disabled:cursor-default transition-colors rounded"
        aria-label="Move shot down"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
