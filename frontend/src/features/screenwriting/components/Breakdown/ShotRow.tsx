import { useCallback } from 'react';
import { Sparkles } from 'lucide-react';
import { InlineEditCell } from './InlineEditCell';
import type { Shot, ShotFields } from '../../types';

// The 5 visible editable columns
const EDITABLE_COLUMNS: Array<{ key: keyof ShotFields; label: string }> = [
  { key: 'shot_size', label: 'Size' },
  { key: 'camera_angle', label: 'Angle' },
  { key: 'camera_movement', label: 'Movement' },
  { key: 'description', label: 'Description' },
  { key: 'action', label: 'Action' },
];

interface ShotRowProps {
  shot: Shot;
  onUpdateField: (shotId: string, fieldKey: string, newValue: string, existingFields: ShotFields) => void;
  actionCell?: React.ReactNode;
}

export function ShotRow({ shot, onUpdateField, actionCell }: ShotRowProps) {
  const handleSave = useCallback((fieldKey: string, newValue: string) => {
    onUpdateField(shot.id, fieldKey, newValue, shot.fields);
  }, [shot.id, shot.fields, onUpdateField]);

  return (
    <div
      data-shot-id={shot.id}
      className="grid hover:bg-card/30 transition-colors group"
      style={{
        gridTemplateColumns: '48px repeat(2, minmax(80px, 1fr)) minmax(80px, 1fr) repeat(2, minmax(120px, 2fr)) 80px',
      }}
    >
      {/* Shot number - read-only */}
      <div className="flex items-center justify-center gap-0.5 px-1 py-2 text-xs font-semibold text-primary min-h-[40px]">
        {shot.shot_number}
        {shot.ai_generated && (
          <span title="AI generated">
            <Sparkles className="h-2.5 w-2.5 text-blue-400/60 flex-shrink-0" />
          </span>
        )}
      </div>

      {/* Editable field cells */}
      {EDITABLE_COLUMNS.map(col => (
        <div key={col.key} className="border-l border-border/50 min-w-0">
          <InlineEditCell
            value={shot.fields[col.key] ?? ''}
            fieldKey={col.key}
            onSave={handleSave}
          />
        </div>
      ))}

      {/* Action cell - receives content from parent (reorder/delete in Plan 02) */}
      <div className="flex items-center justify-end px-2 border-l border-border/50 min-h-[40px]">
        {actionCell}
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { EDITABLE_COLUMNS };
