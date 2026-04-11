import { AlertTriangle, X } from 'lucide-react';

interface ShotlistStalenessBarProps {
  onDismiss: () => void;
  isPending: boolean;
}

export function ShotlistStalenessBar({ onDismiss, isPending }: ShotlistStalenessBarProps) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex-shrink-0"
    >
      <div className="flex items-center gap-2 text-xs text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        <span>Shotlist may be outdated -- script has changed since shots were last reviewed.</span>
      </div>
      <button
        onClick={onDismiss}
        disabled={isPending}
        aria-label="Dismiss staleness warning"
        className="p-1 text-amber-400/60 hover:text-amber-400 transition-colors flex-shrink-0 ml-4 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
