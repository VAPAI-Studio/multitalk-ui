import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { type Book, type Snippet } from '../../types';
import { SnippetCard } from './SnippetCard';
import { SnippetSearchBar } from './SnippetSearchBar';

export function SnippetManager() {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const queryClient = useQueryClient();

  const { data: books = [] } = useQuery({
    queryKey: [QUERY_KEYS.BOOKS],
    queryFn: api.getBooks,
  });

  const selectedBook = books.find((b: Book) => b.id === selectedBookId);
  const isProcessing = !!selectedBook && selectedBook.status !== 'completed';

  const { data: snippetData, isLoading: snippetsLoading } = useQuery({
    queryKey: QUERY_KEYS.SNIPPETS(selectedBookId ?? ''),
    queryFn: () => api.getSnippets(selectedBookId!, { per_page: 200 }),
    enabled: !!selectedBookId,
  });

  // Client-side text filter — NO API call on keystroke (BROW-04)
  const filteredSnippets = useMemo(() => {
    if (!searchQuery.trim()) return snippetData?.items ?? [];
    const q = searchQuery.toLowerCase();
    return (snippetData?.items ?? []).filter((s: Snippet) =>
      s.content.toLowerCase().includes(q) ||
      (s.chapter_title?.toLowerCase().includes(q) ?? false)
    );
  }, [snippetData?.items, searchQuery]);

  // BROW-06: Total tokens from UNFILTERED list — does not change when filter active
  const totalTokens = useMemo(
    () => (snippetData?.items ?? []).reduce((sum: number, s: Snippet) => sum + s.token_count, 0),
    [snippetData?.items]
  );

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.editSnippet(id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SNIPPETS(selectedBookId ?? '') });
      setEditingId(null);
      setEditContent('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteSnippet(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SNIPPETS(selectedBookId ?? '') });
    },
  });

  const handleBookChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedBookId(e.target.value || null);
    setSearchQuery('');
    setEditingId(null);
    setEditContent('');
  };

  const handleEditStart = (id: string, content: string) => {
    setEditingId(id);
    setEditContent(content);
  };

  const handleEditSave = (id: string) => {
    editMutation.mutate({ id, content: editContent });
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditContent('');
    editMutation.reset();
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Snippets</h1>

        {/* Book selector */}
        <select
          value={selectedBookId ?? ''}
          onChange={handleBookChange}
          className="px-3 py-2 text-sm bg-muted/40 border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring text-foreground min-w-48"
        >
          <option value="">Select a book...</option>
          {books.map((b: Book) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </div>

      {/* Processing banner (BROW-05) */}
      {selectedBook && isProcessing && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-400 mb-4">
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
          <span>
            This book is still processing ({selectedBook.processing_step ?? selectedBook.status}).
            Snippets are being extracted — editing is disabled until processing completes.
          </span>
        </div>
      )}

      {selectedBookId && (
        <>
          {/* Search bar */}
          <div className="mb-4">
            <SnippetSearchBar value={searchQuery} onChange={setSearchQuery} />
          </div>

          {/* Total token count — always from unfiltered list */}
          {snippetData && (
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-muted-foreground">
                {filteredSnippets.length === snippetData.items.length
                  ? `${snippetData.items.length} snippet${snippetData.items.length !== 1 ? 's' : ''}`
                  : `${filteredSnippets.length} of ${snippetData.items.length} snippets`}
              </span>
              <span className="text-sm text-muted-foreground">
                Total: <span className="text-foreground font-medium">{totalTokens.toLocaleString()}</span> tokens
              </span>
            </div>
          )}

          {/* Loading spinner */}
          {snippetsLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Empty state */}
          {!snippetsLoading && filteredSnippets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground text-sm">
                {searchQuery
                  ? 'No snippets match your search.'
                  : 'No snippets found for this book yet.'}
              </p>
            </div>
          )}

          {/* Snippet list */}
          {!snippetsLoading && filteredSnippets.length > 0 && (
            <div className="flex flex-col gap-3">
              {filteredSnippets.map((snippet: Snippet) => (
                <SnippetCard
                  key={snippet.id}
                  snippet={snippet}
                  isProcessing={isProcessing}
                  editingId={editingId}
                  editContent={editContent}
                  onEditStart={handleEditStart}
                  onEditChange={setEditContent}
                  onEditSave={handleEditSave}
                  onEditCancel={handleEditCancel}
                  isSaving={editMutation.isPending && editingId === snippet.id}
                  saveError={
                    editMutation.isError && editingId === snippet.id
                      ? (editMutation.error as Error)?.message ?? 'Unknown error'
                      : null
                  }
                  onDelete={(id) => deleteMutation.mutate(id)}
                  isDeleting={deleteMutation.isPending && deleteMutation.variables === snippet.id}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* No book selected state */}
      {!selectedBookId && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">
            Select a book above to view its snippets.
          </p>
        </div>
      )}
    </div>
  );
}
