import { diffLines } from 'diff';

interface TextDiffProps {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
}

export function TextDiff({ before, after, beforeLabel, afterLabel }: TextDiffProps) {
  if (!before && !after) {
    return (
      <div className="text-xs text-muted-foreground/50 italic py-2 px-3">
        No content on either side
      </div>
    );
  }

  const changes = diffLines(before || '', after || '');

  // Build left (before) and right (after) line arrays
  const leftLines: Array<{ text: string; type: 'removed' | 'unchanged' }> = [];
  const rightLines: Array<{ text: string; type: 'added' | 'unchanged' }> = [];

  for (const change of changes) {
    const lines = change.value.split('\n');
    // Remove trailing empty string from split
    if (lines[lines.length - 1] === '') lines.pop();

    if (change.removed) {
      for (const line of lines) {
        leftLines.push({ text: line, type: 'removed' });
        rightLines.push({ text: '', type: 'unchanged' }); // spacer
      }
    } else if (change.added) {
      for (const line of lines) {
        leftLines.push({ text: '', type: 'unchanged' }); // spacer
        rightLines.push({ text: line, type: 'added' });
      }
    } else {
      for (const line of lines) {
        leftLines.push({ text: line, type: 'unchanged' });
        rightLines.push({ text: line, type: 'unchanged' });
      }
    }
  }

  const maxLines = Math.max(leftLines.length, rightLines.length);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Left - Before */}
      <div>
        <div className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">
          {beforeLabel}
        </div>
        <div className="rounded-md border border-border/30 bg-muted/10 overflow-hidden">
          {leftLines.length === 0 ? (
            <div className="text-xs text-muted-foreground/40 italic p-2">No content</div>
          ) : (
            Array.from({ length: maxLines }).map((_, i) => {
              const line = leftLines[i];
              if (!line) return <div key={i} className="h-5" />;
              const bg = line.type === 'removed' ? 'bg-red-500/20' : '';
              const textColor = line.type === 'removed' ? 'text-red-300' : 'text-foreground/70';
              return (
                <div
                  key={i}
                  className={`font-mono text-xs whitespace-pre-wrap px-2 py-0.5 min-h-[20px] ${bg} ${textColor}`}
                >
                  {line.text || '\u00A0'}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right - After */}
      <div>
        <div className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">
          {afterLabel}
        </div>
        <div className="rounded-md border border-border/30 bg-muted/10 overflow-hidden">
          {rightLines.length === 0 ? (
            <div className="text-xs text-muted-foreground/40 italic p-2">No content</div>
          ) : (
            Array.from({ length: maxLines }).map((_, i) => {
              const line = rightLines[i];
              if (!line) return <div key={i} className="h-5" />;
              const bg = line.type === 'added' ? 'bg-green-500/20' : '';
              const textColor = line.type === 'added' ? 'text-green-300' : 'text-foreground/70';
              return (
                <div
                  key={i}
                  className={`font-mono text-xs whitespace-pre-wrap px-2 py-0.5 min-h-[20px] ${bg} ${textColor}`}
                >
                  {line.text || '\u00A0'}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
