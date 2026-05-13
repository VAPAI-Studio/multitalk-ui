import { useRef, useEffect } from 'react';
import type { Shot } from '../../types';

interface ShotOverlayPopoverProps {
  shots: Shot[];
  rect: DOMRect;
  onDismiss: () => void;
}

export function ShotOverlayPopover({ shots, rect, onDismiss }: ShotOverlayPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
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

  const sortedShots = [...shots].sort((a, b) => a.shot_number - b.shot_number);

  return (
    <div
      ref={popoverRef}
      onMouseDown={(e) => e.preventDefault()}
      className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-sm"
      style={{
        position: 'fixed',
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
        zIndex: 50,
      }}
    >
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Linked Shots
      </div>

      {sortedShots.map((shot, index) => {
        const details: string[] = [];
        if (shot.fields.shot_size) details.push(shot.fields.shot_size);
        if (shot.fields.camera_angle) details.push(shot.fields.camera_angle);
        if (shot.fields.description) details.push(shot.fields.description);

        return (
          <div
            key={shot.id}
            className={index > 0 ? 'border-t border-border/50 pt-2 mt-2' : ''}
          >
            <div className="text-sm font-medium text-foreground">
              Shot {shot.shot_number}
            </div>
            {details.length > 0 && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {details.join(' | ')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
