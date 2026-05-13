import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, GripVertical, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { SubsectionConfig, PhaseDataResponse, TemplateConfig, ListItemResponse } from '../../types/template';

interface OrderedListViewProps {
  subsection: SubsectionConfig;
  projectId: string;
  phase: string;
  phaseData: PhaseDataResponse | null;
  templateConfig: TemplateConfig;
}

export function OrderedListView({ subsection, projectId, phase, phaseData }: OrderedListViewProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const listConfig = subsection.list_config;
  const itemType = listConfig?.item_type || 'item';
  const summaryField = listConfig?.summary_field || 'summary';

  const { data: items = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.LIST_ITEMS(phaseData?.id || ''),
    queryFn: () => api.getListItems(phaseData!.id),
    enabled: !!phaseData?.id,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createListItem(phaseData!.id, {
        item_type: itemType,
        content: {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.LIST_ITEMS(phaseData!.id) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteListItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.LIST_ITEMS(phaseData!.id) });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (reordered: Array<{ id: string; sort_order: number }>) =>
      api.reorderListItems(phaseData!.id, reordered),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.LIST_ITEMS(phaseData!.id) });
    },
  });

  const editorSubsectionKey = subsection.key.replace('_list', '_detail');

  const handleItemClick = (item: ListItemResponse) => {
    navigate(`/projects/${projectId}/${phase}/${editorSubsectionKey}/${item.id}`);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newItems = [...items];
    const [draggedItem] = newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, draggedItem);
    setDraggedIndex(index);
    const reordered = newItems.map((item, i) => ({ id: item.id, sort_order: i }));
    reorderMutation.mutate(reordered);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const STATUS_STYLES: Record<string, string> = {
    complete: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    in_progress: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    draft: 'bg-muted text-muted-foreground border-transparent',
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-muted-foreground">Loading items...</span>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="font-display text-2xl font-semibold text-foreground">{subsection.name}</h2>
          {subsection.description && (
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{subsection.description}</p>
          )}
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg shadow-md shadow-amber-900/20 hover:bg-amber-600 transition-colors disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add {itemType.replace('_', ' ')}
        </button>
      </div>

      {/* Count */}
      <div className="text-xs text-muted-foreground mb-4 font-mono">
        {items.length} {items.length === 1 ? itemType.replace('_', ' ') : `${itemType.replace('_', ' ')}s`}
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-16 text-center">
          <p className="text-sm text-muted-foreground">No items yet. Add one or use the wizard to generate them.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item, index) => {
            const summary = (item.content as Record<string, string>)[summaryField] || `${itemType.replace('_', ' ')} ${index + 1}`;
            const status = item.status || 'draft';

            return (
              <div
                key={item.id}
                draggable={listConfig?.sortable !== false}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => handleItemClick(item)}
                className={`
                  group flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card/60
                  cursor-pointer transition-all duration-200 hover:bg-card hover:border-amber-500/15
                  ${draggedIndex === index ? 'opacity-40 scale-[0.98]' : ''}
                `}
                style={{ animationDelay: `${index * 30}ms`, animationFillMode: 'both' }}
              >
                {/* Drag Handle */}
                {listConfig?.sortable !== false && (
                  <GripVertical className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 cursor-grab flex-shrink-0" />
                )}

                {/* Number */}
                <span className="text-xs text-muted-foreground font-mono w-6 text-right flex-shrink-0">{index + 1}</span>

                {/* Summary */}
                <span className="flex-1 text-sm text-foreground truncate group-hover:text-amber-100 transition-colors">{summary}</span>

                {/* Status */}
                {listConfig?.show_status !== false && (
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>
                    {status}
                  </span>
                )}

                {/* Delete */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Delete this item?')) deleteMutation.mutate(item.id);
                  }}
                  className="p-1 text-transparent group-hover:text-muted-foreground hover:!text-destructive transition-colors rounded"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
