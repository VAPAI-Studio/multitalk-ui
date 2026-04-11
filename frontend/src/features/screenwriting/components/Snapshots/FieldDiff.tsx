import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FieldChange } from '../../lib/diff-utils';

interface FieldDiffProps {
  changes: FieldChange[];
  phaseName: string;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'string') return value || '(empty)';
  return JSON.stringify(value, null, 2);
}

export function FieldDiff({ changes, phaseName }: FieldDiffProps) {
  const [showAll, setShowAll] = useState(false);

  const changedFields = changes.filter((c) => c.changed);
  const unchangedFields = changes.filter((c) => !c.changed);
  const displayedFields = showAll ? changes : changedFields;

  if (changes.length === 0) {
    return null;
  }

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-foreground/80 capitalize">{phaseName}</span>
        {unchangedFields.length > 0 && (
          <button
            onClick={() => setShowAll((prev) => !prev)}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            {showAll ? (
              <>
                <ChevronDown className="h-3 w-3" />
                Hide unchanged
              </>
            ) : (
              <>
                <ChevronRight className="h-3 w-3" />
                Show all ({changes.length})
              </>
            )}
          </button>
        )}
      </div>

      {changedFields.length === 0 && !showAll && (
        <div className="text-[11px] text-muted-foreground/50 italic pl-2">No changes</div>
      )}

      <div className="space-y-1">
        {displayedFields.map((change) => (
          <div
            key={change.field}
            className={`pl-2 border-l-2 ${
              change.changed ? 'border-amber-400/60' : 'border-border/30'
            }`}
          >
            <div className="text-[11px] font-medium text-muted-foreground">{change.field}</div>
            {change.changed ? (
              <div className="grid grid-cols-2 gap-2 mt-0.5">
                <div className="text-[10px] bg-red-500/10 text-red-300 rounded px-1.5 py-0.5 whitespace-pre-wrap break-words">
                  {formatValue(change.before)}
                </div>
                <div className="text-[10px] bg-green-500/10 text-green-300 rounded px-1.5 py-0.5 whitespace-pre-wrap break-words">
                  {formatValue(change.after)}
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground/50 truncate">
                {formatValue(change.before)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
