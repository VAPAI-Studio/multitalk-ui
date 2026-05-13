// frontend/src/hooks/useKeyboardShortcuts.ts

import { useEffect } from 'react';

interface UseKeyboardShortcutsProps {
  onSave?: () => void;
  onReview?: () => void;
}

export function useKeyboardShortcuts({ onSave, onReview }: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        onSave?.();
      }
      
      // Cmd/Ctrl + Enter
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        onReview?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onSave, onReview]);
}
