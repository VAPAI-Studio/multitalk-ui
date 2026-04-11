import { type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface BreakdownPanelProps {
  title: string;
  side: 'left' | 'right';
  collapsed: boolean;
  onToggleCollapse: () => void;
  children: ReactNode;
  style?: React.CSSProperties;
}

export function BreakdownPanel({
  title,
  side,
  collapsed,
  onToggleCollapse,
  children,
  style,
}: BreakdownPanelProps) {
  if (collapsed) {
    return (
      <div
        className="w-9 flex-shrink-0 border-border flex flex-col items-center py-3 gap-2"
        style={{
          borderRightWidth: side === 'left' ? '1px' : '0',
          borderLeftWidth: side === 'right' ? '1px' : '0',
          borderStyle: 'solid',
        }}
      >
        <button
          onClick={onToggleCollapse}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={`Expand ${title}`}
        >
          {side === 'left'
            ? <ChevronRight className="h-4 w-4" />
            : <ChevronLeft className="h-4 w-4" />}
        </button>
        <span
          className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {title}
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full overflow-hidden flex-shrink-0"
      style={style}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{ borderBottomWidth: '1px', borderStyle: 'solid', borderColor: 'hsl(var(--border))' }}
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        <button
          onClick={onToggleCollapse}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={`Collapse ${title}`}
        >
          {side === 'left'
            ? <ChevronLeft className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
      {/* Panel content */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
