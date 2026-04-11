import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, X, UserCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, ROUTES } from '../../lib/constants';
import type { BreakdownElement } from '../../types';

interface ElementCardProps {
  element: BreakdownElement;
  projectId: string;
  category: string;
}

export function ElementCard({ element, projectId, category }: ElementCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(element.name);
  const [editDescription, setEditDescription] = useState(element.description);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateMutation = useMutation({
    mutationFn: ({ id, name, description }: { id: string; name: string; description: string }) =>
      api.updateBreakdownElement(id, { name, description }),
    onMutate: async ({ id, name, description }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category) });
      const previous = queryClient.getQueryData<BreakdownElement[]>(
        QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category)
      );
      queryClient.setQueryData(
        QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category),
        (old: BreakdownElement[] | undefined) =>
          (old ?? []).map(el =>
            el.id === id ? { ...el, name, description, user_modified: true } : el
          )
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category) });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_SUMMARY(projectId) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (elementId: string) => api.deleteBreakdownElement(elementId),
    onMutate: async (elementId) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category) });
      const previous = queryClient.getQueryData(QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category));
      queryClient.setQueryData(
        QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category),
        (old: BreakdownElement[] | undefined) => (old ?? []).filter(el => el.id !== elementId)
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category) });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BREAKDOWN_SUMMARY(projectId) });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncBreakdownElementToCharacters(element.id),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId, category),
      });
    },
  });

  const handleDeleteClick = () => {
    setDeleteConfirm(true);
    if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    deleteConfirmTimerRef.current = setTimeout(() => setDeleteConfirm(false), 3000);
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    setDeleteConfirm(false);
    deleteMutation.mutate(element.id);
  };

  const handleDeleteCancel = () => {
    if (deleteConfirmTimerRef.current) clearTimeout(deleteConfirmTimerRef.current);
    setDeleteConfirm(false);
  };

  const saveEdit = useCallback(() => {
    setIsEditing(false);
    if (editName.trim() !== element.name || editDescription.trim() !== element.description) {
      updateMutation.mutate({
        id: element.id,
        name: editName.trim() || element.name,
        description: editDescription.trim(),
      });
    }
  }, [editName, editDescription, element.name, element.description, element.id, updateMutation]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName(element.name);
    setEditDescription(element.description);
  }, [element.name, element.description]);

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const handleBlur = () => {
    blurTimeoutRef.current = setTimeout(() => {
      saveEdit();
    }, 150);
  };

  const handleFocus = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  return (
    <div className="group rounded-lg border border-border/50 hover:border-border bg-card/40 hover:bg-card/60 p-4 transition-all">
      {isEditing ? (
        <div className="space-y-2">
          <input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={handleBlur}
            onFocus={handleFocus}
            className="w-full bg-background border border-border rounded px-2 py-1 text-sm font-semibold
              text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50"
          />
          <textarea
            value={editDescription}
            onChange={e => setEditDescription(e.target.value)}
            onKeyDown={handleDescriptionKeyDown}
            onBlur={handleBlur}
            onFocus={handleFocus}
            rows={3}
            className="w-full bg-background border border-border rounded px-2 py-1 text-sm
              text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50 resize-none"
          />
        </div>
      ) : (
        <div
          className="cursor-pointer"
          onClick={() => navigate(ROUTES.ELEMENT_DETAIL(projectId, element.id))}
        >
          {/* Name row */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="font-semibold text-sm text-foreground truncate">
                {element.name}
              </span>
              {element.user_modified && (
                <span title="User modified" className="flex-shrink-0">
                  <Pencil className="h-3 w-3 text-amber-400/70" />
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Source badge */}
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  element.source === 'ai'
                    ? 'bg-blue-500/10 text-blue-400'
                    : 'bg-emerald-500/10 text-emerald-400'
                }`}
              >
                {element.source === 'ai' ? 'AI' : 'User'}
              </span>
              {/* Quick edit button */}
              <button
                onClick={e => { e.stopPropagation(); setIsEditing(true); }}
                className="text-muted-foreground/40 hover:text-amber-400 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                title="Quick edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {/* Delete controls */}
              <div
                className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={e => e.stopPropagation()}
              >
                {deleteConfirm ? (
                  <>
                    <button
                      onClick={handleDeleteConfirm}
                      className="text-xs text-red-400 hover:text-red-300 font-semibold px-2 py-1
                        rounded hover:bg-red-500/10 transition-colors"
                    >
                      Delete?
                    </button>
                    <button
                      onClick={handleDeleteCancel}
                      className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleDeleteClick}
                    disabled={deleteMutation.isPending}
                    className="text-muted-foreground/40 hover:text-red-400 p-1 rounded transition-colors
                      disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Description */}
          {element.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
              {element.description}
            </p>
          )}

          {/* Scene chips */}
          {element.scene_links.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {element.scene_links.map((link, index) => (
                <button
                  key={link.id}
                  onClick={e => {
                    e.stopPropagation();
                    navigate(ROUTES.PROJECT_WORKSPACE(projectId, 'scenes', 'scene_list', link.scene_item_id));
                  }}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground
                    hover:bg-muted/70 hover:text-foreground transition-colors border border-border/40"
                >
                  Scene {index + 1}
                </button>
              ))}
            </div>
          )}

          {/* Add to Characters button (character elements only) */}
          {category === 'character' && !isEditing && (
            <div className="mt-2 flex items-center" onClick={e => e.stopPropagation()}>
              {element.synced_to_characters || syncMutation.isSuccess ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
                  <UserCheck className="h-3 w-3" />
                  Synced
                </span>
              ) : (
                <button
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  className="text-[10px] text-emerald-400/80 hover:text-emerald-400
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {syncMutation.isPending ? 'Adding...' : '+ Add to Characters'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
