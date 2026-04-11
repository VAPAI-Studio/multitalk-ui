import { Plus } from 'lucide-react';

interface AddShotButtonProps {
  onClick: () => void;
  isPending: boolean;
}

export function AddShotButton({ onClick, isPending }: AddShotButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={isPending}
      className="w-full h-9 flex items-center justify-center gap-1.5 text-xs font-semibold
        text-muted-foreground hover:text-foreground hover:bg-muted transition-colors
        disabled:opacity-40 disabled:cursor-default"
    >
      <Plus className="h-3.5 w-3.5" />
      Add Shot
    </button>
  );
}
