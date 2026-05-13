import { useState, useRef, useCallback } from 'react';

interface InlineEditCellProps {
  value: string;
  fieldKey: string;
  onSave: (fieldKey: string, newValue: string) => void;
}

export function InlineEditCell({ value, fieldKey, onSave }: InlineEditCellProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(() => {
    setEditing(false);
    if (editValue.trim() !== value) {
      onSave(fieldKey, editValue.trim());
    }
  }, [editValue, value, fieldKey, onSave]);

  const cancel = useCallback(() => {
    setEditing(false);
    setEditValue(value);
  }, [value]);

  if (!editing) {
    return (
      <div
        onClick={() => { setEditValue(value); setEditing(true); }}
        className="truncate cursor-text px-2 py-2 text-sm text-foreground min-h-[40px] flex items-center"
      >
        {value || <span className="text-muted-foreground/40">--</span>}
      </div>
    );
  }

  return (
    <input
      autoFocus
      value={editValue}
      onChange={e => setEditValue(e.target.value)}
      onBlur={() => { blurTimeoutRef.current = setTimeout(save, 150); }}
      onFocus={() => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current); }}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') cancel();
      }}
      className="w-full bg-surface border border-border rounded px-2 py-1 text-sm
        text-foreground focus:ring-1 focus:ring-primary/50 focus:outline-none"
    />
  );
}
