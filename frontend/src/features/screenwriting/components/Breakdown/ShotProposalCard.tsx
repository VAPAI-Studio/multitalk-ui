import { useState } from 'react';
import { Camera, Plus, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { ShotAction, Shot } from '../../types';

interface ShotProposalCardProps {
  projectId: string;
  action: ShotAction;
  existingShots: Shot[];
  onDismiss: () => void;
  onConfirmed: (message: string) => void;
}

const formatFieldLabel = (key: string) =>
  key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export function ShotProposalCard({ projectId, action, existingShots, onDismiss, onConfirmed }: ShotProposalCardProps) {
  const [applying, setApplying] = useState(false);
  const queryClient = useQueryClient();

  const isCreate = action.type === 'create';
  const label = isCreate ? 'NEW SHOT' : 'SHOT CHANGES';
  const confirmLabel = isCreate ? 'Create Shot' : 'Apply Changes';
  const Icon = isCreate ? Plus : Camera;
  const fields = action.data.fields || {};
  const nonEmptyFields = Object.entries(fields).filter(([, v]) => v && String(v).trim() !== '');

  const handleConfirm = async () => {
    setApplying(true);
    try {
      if (action.type === 'create') {
        const result = await api.createShot(projectId, {
          scene_item_id: action.data.scene_item_id || null,
          shot_number: action.data.shot_number || (existingShots.length > 0 ? Math.max(...existingShots.map(s => s.shot_number)) + 1 : 1),
          fields: action.data.fields || {},
          source: 'ai',
        });
        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SHOTS(projectId) });
        onConfirmed(`Shot #${result.shot_number} created`);
      } else if (action.type === 'modify' && action.shot_id) {
        const existingShot = existingShots.find(s => s.id === action.shot_id);
        const mergedFields = existingShot
          ? { ...existingShot.fields, ...(action.data.fields || {}) }
          : action.data.fields || {};
        const result = await api.updateShot(projectId, action.shot_id, {
          fields: mergedFields,
          ...(action.data.shot_number !== undefined ? { shot_number: action.data.shot_number } : {}),
        });
        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SHOTS(projectId) });
        onConfirmed(`Shot #${result.shot_number} updated`);
      }
    } catch (err) {
      onConfirmed(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="mx-3 mb-3 rounded-xl border border-primary/25 bg-primary/5 p-3 animate-scale-in">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold text-primary uppercase tracking-wider">{label}</span>
      </div>

      {/* Fields */}
      <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
        {action.data.shot_number !== undefined && (
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Shot Number</span>
            <p className="text-xs text-foreground/70 leading-snug">#{action.data.shot_number}</p>
          </div>
        )}
        {action.data.scene_item_id && (
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Scene</span>
            <p className="text-xs text-foreground/70 leading-snug">{action.data.scene_item_id}</p>
          </div>
        )}
        {nonEmptyFields.map(([key, value]) => (
          <div key={key}>
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{formatFieldLabel(key)}</span>
            <p className="text-xs text-foreground/70 leading-snug line-clamp-3">{String(value)}</p>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={applying}
          className="flex-1 px-3 py-1.5 text-xs font-medium bg-primary/20 text-primary border border-primary/20 rounded-lg transition-colors hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          aria-label={isCreate ? 'Create shot' : 'Apply changes to shot'}
        >
          {applying && <Loader2 className="h-3 w-3 animate-spin" />}
          {confirmLabel}
        </button>
        <button
          onClick={onDismiss}
          disabled={applying}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
