import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { BreakdownRun } from '../../types';

interface StalenessBarProps {
  extractMutation: UseMutationResult<BreakdownRun, Error, void, unknown>;
}

export function StalenessBar({ extractMutation }: StalenessBarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 bg-amber-500/10 border-b border-amber-500/20 flex-shrink-0">
      <div className="flex items-center gap-2 text-sm text-amber-400">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>Your breakdown may be outdated — script has changed since last extraction.</span>
      </div>
      <button
        onClick={() => extractMutation.mutate()}
        disabled={extractMutation.isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-400
          bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-md transition-colors
          disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0 ml-4"
      >
        {extractMutation.isPending
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <RefreshCw className="h-3.5 w-3.5" />}
        {extractMutation.isPending ? 'Extracting...' : 'Refresh'}
      </button>
    </div>
  );
}
