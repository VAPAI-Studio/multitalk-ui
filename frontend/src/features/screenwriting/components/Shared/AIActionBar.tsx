import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wand2, MessageSquare, Bot, Loader2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { AIActionDef } from '../../types/template';

const ACTION_ICONS: Record<string, typeof Wand2> = {
  wand: Wand2,
  'message-square': MessageSquare,
};

interface AIActionBarProps {
  actions: AIActionDef[];
  projectId: string;
  phase: string;
  subsectionKey: string;
  itemId?: string;
}

export function AIActionBar({ actions, projectId, phase, subsectionKey, itemId }: AIActionBarProps) {
  const queryClient = useQueryClient();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const fillBlanksMutation = useMutation({
    mutationFn: () => {
      const payload = { project_id: projectId, phase, subsection_key: subsectionKey, item_id: itemId };
      console.log('[AIActionBar] fillBlanks payload:', JSON.stringify(payload, null, 2));
      return api.fillBlanks(payload);
    },
    onSuccess: (data) => {
      console.log('[AIActionBar] fillBlanks SUCCESS:', JSON.stringify(data, null, 2));
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SUBSECTION_DATA(projectId, phase, subsectionKey) });
      setActiveAction(null);
    },
    onError: (err: Error) => {
      console.error('[AIActionBar] fillBlanks ERROR:', err.message, err);
      setActiveAction(null);
    },
  });

  const giveNotesMutation = useMutation({
    mutationFn: () => {
      const payload = { project_id: projectId, phase, subsection_key: subsectionKey, item_id: itemId };
      console.log('[AIActionBar] giveNotes payload:', JSON.stringify(payload, null, 2));
      return api.giveNotes(payload);
    },
    onSuccess: (data) => {
      console.log('[AIActionBar] giveNotes SUCCESS:', JSON.stringify(data, null, 2));
      setNotes(typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data));
      setActiveAction(null);
    },
    onError: (err: Error) => {
      console.error('[AIActionBar] giveNotes ERROR:', err.message, err);
      setActiveAction(null);
    },
  });

  const handleAction = (action: AIActionDef) => {
    console.log('[AIActionBar] handleAction:', action.key, { projectId, phase, subsectionKey, itemId });
    setActiveAction(action.key);
    if (action.key === 'fill_blanks') {
      fillBlanksMutation.mutate();
    } else if (action.key === 'give_notes') {
      giveNotesMutation.mutate();
    }
  };

  const isLoading = fillBlanksMutation.isPending || giveNotesMutation.isPending;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {actions.map((action) => {
          const Icon = ACTION_ICONS[action.icon || ''] || Bot;
          const isActive = isLoading && activeAction === action.key;

          return (
            <button
              key={action.key}
              onClick={() => handleAction(action)}
              disabled={isLoading}
              className={`
                flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-all duration-200
                ${isActive
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground/30'
                }
                disabled:opacity-40
              `}
            >
              {isActive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              {action.label}
            </button>
          );
        })}
      </div>

      {notes && (
        <div className="bg-card border border-border rounded-xl p-4 animate-fade-up">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Notes</h4>
            <button
              onClick={() => setNotes(null)}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <pre className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed font-body">{notes}</pre>
        </div>
      )}
    </div>
  );
}
