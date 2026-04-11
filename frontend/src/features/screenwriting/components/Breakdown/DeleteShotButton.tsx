import { useState, useRef } from 'react';
import { Trash2, X } from 'lucide-react';

interface DeleteShotButtonProps {
  onDelete: () => void;
  isPending: boolean;
}

export function DeleteShotButton({ onDelete, isPending }: DeleteShotButtonProps) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDeleteClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      onDelete();
      return;
    }
    setDeleteConfirm(true);
    if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    deleteConfirmTimerRef.current = setTimeout(() => setDeleteConfirm(false), 3000);
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    setDeleteConfirm(false);
    onDelete();
  };

  const handleDeleteCancel = () => {
    if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    setDeleteConfirm(false);
  };

  if (deleteConfirm) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={handleDeleteConfirm}
          className="text-xs text-red-400 hover:text-red-300 font-semibold px-1 py-0.5
            rounded hover:bg-red-500/10 transition-colors"
        >
          Delete?
        </button>
        <button
          onClick={handleDeleteCancel}
          className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleDeleteClick}
      title="Delete shot (Shift+click to skip confirmation)"
      disabled={isPending}
      className="text-muted-foreground/40 hover:text-red-400 p-1 rounded transition-colors
        disabled:opacity-30"
      aria-label="Delete shot"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
