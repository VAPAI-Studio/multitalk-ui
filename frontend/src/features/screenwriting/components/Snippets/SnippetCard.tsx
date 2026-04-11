import { useState } from 'react';
import { Pencil, Trash2, Loader2 } from 'lucide-react';
import { type Snippet } from '../../types';

interface SnippetCardProps {
  snippet: Snippet;
  isProcessing: boolean;
  editingId: string | null;
  editContent: string;
  onEditStart: (id: string, content: string) => void;
  onEditChange: (content: string) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  isSaving: boolean;
  saveError: string | null;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

export function SnippetCard({
  snippet,
  isProcessing,
  editingId,
  editContent,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  isSaving,
  saveError,
  onDelete,
  isDeleting,
}: SnippetCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isEditing = editingId === snippet.id;

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDelete(snippet.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  const handleDeleteBlur = () => {
    setConfirmDelete(false);
  };

  return (
    <div className="bg-muted/20 border border-border/40 rounded-xl p-4">
      {isEditing ? (
        /* Edit mode */
        <div className="flex flex-col gap-3">
          <textarea
            value={editContent}
            onChange={(e) => onEditChange(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 text-sm bg-muted/40 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring text-foreground resize-y"
            disabled={isSaving}
          />
          {saveError && (
            <p className="text-sm text-red-400">Re-embedding failed. Content not saved.</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEditSave(snippet.id)}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
            <button
              onClick={onEditCancel}
              disabled={isSaving}
              className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Display mode */
        <div className="flex flex-col gap-3">
          {/* Header row: chapter / page + token count */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {snippet.chapter_title && (
                <span className="font-medium">{snippet.chapter_title}</span>
              )}
              {snippet.chapter_title && snippet.page_number != null && (
                <span>·</span>
              )}
              {snippet.page_number != null && (
                <span>p. {snippet.page_number}</span>
              )}
            </div>
            <span className="flex-shrink-0 text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
              {snippet.token_count} tokens
            </span>
          </div>

          {/* Content (CSS line-clamp to ~5 lines) */}
          <p className="text-sm text-foreground leading-relaxed line-clamp-5">
            {snippet.content}
          </p>

          {/* Justification — why this snippet was selected */}
          {snippet.justification && (
            <p className="text-xs text-muted-foreground/80 italic border-l-2 border-amber-500/30 pl-2.5 leading-relaxed">
              {snippet.justification}
            </p>
          )}

          {/* Concept name badges */}
          {snippet.concept_names.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {snippet.concept_names.map((name, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20"
                >
                  {name}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onEditStart(snippet.id, snippet.content)}
              disabled={isProcessing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors hover:bg-muted/40"
              title="Edit snippet"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>

            {confirmDelete ? (
              <button
                onClick={handleDeleteClick}
                onBlur={handleDeleteBlur}
                disabled={isProcessing || isDeleting}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors hover:bg-red-500/10"
                autoFocus
              >
                {isDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
                Confirm?
              </button>
            ) : (
              <button
                onClick={handleDeleteClick}
                disabled={isProcessing || isDeleting}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-muted-foreground hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors hover:bg-red-500/10"
                title="Delete snippet"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
