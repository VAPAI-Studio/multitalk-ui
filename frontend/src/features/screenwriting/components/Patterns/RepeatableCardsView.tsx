import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ChevronDown, Wand2, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { FieldRenderer } from '../Shared/FieldRenderer';
import type { SubsectionConfig, PhaseDataResponse, TemplateConfig, ListItemResponse } from '../../types/template';

interface RepeatableCardsViewProps {
  subsection: SubsectionConfig;
  projectId: string;
  phase: string;
  phaseData: PhaseDataResponse | null;
  templateConfig: TemplateConfig;
}

export function RepeatableCardsView({ subsection, projectId, phase, phaseData }: RepeatableCardsViewProps) {
  const queryClient = useQueryClient();
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [fillingKey, setFillingKey] = useState<string | null>(null);

  const cardGroups = subsection.card_groups || [];
  const queryKey = QUERY_KEYS.LIST_ITEMS(phaseData?.id || '');

  const { data: items = [] } = useQuery({
    queryKey,
    queryFn: () => api.getListItems(phaseData!.id),
    enabled: !!phaseData?.id,
  });

  const createMutation = useMutation({
    mutationFn: (data: { item_type: string; content: Record<string, any> }) =>
      api.createListItem(phaseData!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: Record<string, any> }) =>
      api.updateListItem(id, { content }),
    // No invalidateQueries — we update the cache directly
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteListItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const autofillMutation = useMutation({
    mutationFn: ({ itemId, fieldKey }: { itemId: string; fieldKey: string }) =>
      api.fillBlanks({ project_id: projectId, phase, subsection_key: subsection.key, item_id: itemId, field_key: fieldKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setFillingKey(null);
    },
    onError: () => {
      setFillingKey(null);
    },
  });

  const handleFieldChange = useCallback((itemId: string, fieldKey: string, value: string) => {
    // Optimistically update the query cache immediately
    queryClient.setQueryData<ListItemResponse[]>(queryKey, (old) => {
      if (!old) return old;
      return old.map(item => {
        if (item.id !== itemId) return item;
        return { ...item, content: { ...(item.content as Record<string, any>), [fieldKey]: value } };
      });
    });

    // Debounce the actual save
    if (saveTimersRef.current[itemId]) clearTimeout(saveTimersRef.current[itemId]);
    saveTimersRef.current[itemId] = setTimeout(() => {
      // Read the latest content from the cache at save time
      const cachedItems = queryClient.getQueryData<ListItemResponse[]>(queryKey);
      const item = cachedItems?.find(i => i.id === itemId);
      if (item) {
        updateMutation.mutate({ id: itemId, content: item.content as Record<string, any> });
      }
    }, 800);
  }, [queryClient, queryKey, updateMutation]);

  const handleAutofill = useCallback((itemId: string, fieldKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const compositeKey = `${itemId}:${fieldKey}`;
    setFillingKey(compositeKey);
    autofillMutation.mutate({ itemId, fieldKey });
  }, [autofillMutation]);

  return (
    <div className="p-8 animate-fade-in">
      {/* Header */}
      <div className="mb-8 max-w-3xl">
        <h2 className="font-display text-2xl font-semibold text-foreground">{subsection.name}</h2>
        {subsection.description && (
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{subsection.description}</p>
        )}
      </div>

      {/* Card Groups */}
      <div className="space-y-10 max-w-3xl">
        {cardGroups.map((group) => {
          const groupItems = items.filter((item) => item.item_type === group.item_type);

          return (
            <div key={group.key}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">{group.label}</h3>
                  {group.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
                  )}
                </div>
                <button
                  onClick={() => createMutation.mutate({ item_type: group.item_type, content: {} })}
                  disabled={createMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/15 transition-colors disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>

              {groupItems.length === 0 ? (
                <div className="border border-dashed border-border rounded-xl p-8 text-center">
                  <p className="text-sm text-muted-foreground">No {group.label.toLowerCase()} yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {groupItems.map((item) => {
                    const isExpanded = expandedItem === item.id;
                    const name = (item.content as Record<string, string>).name || 'Untitled';

                    return (
                      <div
                        key={item.id}
                        className={`rounded-xl border transition-all duration-200 ${
                          isExpanded ? 'border-amber-500/20 bg-card glow-amber' : 'border-border bg-card/60 hover:bg-card'
                        }`}
                      >
                        <div
                          className="flex items-center justify-between px-4 py-3 cursor-pointer"
                          onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                        >
                          <span className="text-sm font-medium text-foreground">{name}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Delete this item?')) deleteMutation.mutate(item.id);
                              }}
                              className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-border px-4 py-4 space-y-4">
                            {group.fields.map((field) => {
                              const compositeKey = `${item.id}:${field.key}`;
                              const isFilling = fillingKey === compositeKey;
                              return (
                                <div key={field.key} className="group/field flex items-start gap-2">
                                  <div className="flex-1">
                                    <FieldRenderer
                                      field={field}
                                      value={(item.content as Record<string, string>)[field.key] || ''}
                                      onChange={(key, val) => handleFieldChange(item.id, key, val)}
                                    />
                                  </div>
                                  <button
                                    onClick={(e) => handleAutofill(item.id, field.key, e)}
                                    disabled={isFilling}
                                    title="Autofill with AI"
                                    className="mt-6 p-1.5 rounded-md text-muted-foreground/50 hover:text-amber-400 hover:bg-amber-500/10 transition-colors opacity-0 group-hover/field:opacity-100 disabled:opacity-100 flex-shrink-0"
                                  >
                                    {isFilling ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                                    ) : (
                                      <Wand2 className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
