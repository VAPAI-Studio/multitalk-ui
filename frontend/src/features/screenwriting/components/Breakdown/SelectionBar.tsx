import { useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';

interface SelectionBarProps {
  rect: DOMRect;
  lineCount: number;
  onAddShot: () => void;
  onDismiss: () => void;
  isPending: boolean;
}

export function SelectionBar({ rect, lineCount, onAddShot, onDismiss, isPending }: SelectionBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onDismiss]);

  return (
    <div
      ref={barRef}
      onMouseDown={(e) => e.preventDefault()}
      className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg shadow-lg"
      style={{
        position: 'fixed',
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
        zIndex: 50,
      }}
    >
      <span className="text-xs text-muted-foreground">
        {lineCount} {lineCount === 1 ? 'line' : 'lines'}
      </span>

      <button
        onClick={onAddShot}
        disabled={isPending}
        className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
        Add Shot
      </button>

      <button
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
