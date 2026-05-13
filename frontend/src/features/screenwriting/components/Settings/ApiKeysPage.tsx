import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Plus, Trash2, Copy, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { Button } from '../UI/Button';
import type { ApiKey } from '../../types';

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    data: keys = [],
    isLoading,
    error,
  } = useQuery<ApiKey[]>({
    queryKey: [QUERY_KEYS.API_KEYS],
    queryFn: () => api.listApiKeys(),
    refetchInterval: 30000, // Auto-refresh usage stats every 30s
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.createApiKey({ name }),
    onSuccess: (data) => {
      setNewKeySecret(data.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.API_KEYS] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => api.revokeApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.API_KEYS] });
    },
  });

  const handleCreate = () => {
    const trimmed = newKeyName.trim();
    if (!trimmed) return;
    createMutation.mutate(trimmed);
  };

  const handleCopy = async () => {
    if (!newKeySecret) return;
    await navigator.clipboard.writeText(newKeySecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDismissModal = () => {
    setNewKeySecret(null);
    setCopied(false);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading API keys...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-sm text-destructive">Failed to load API keys</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12">
      <div className="w-full max-w-lg rounded-lg border border-border/60 bg-card p-8 shadow-lg">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Key className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-xl font-display font-semibold tracking-tight text-foreground">
            API Keys
          </h1>
        </div>

        {/* Create Key Form */}
        <div className="mb-6 flex gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g. CI/CD)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending || !newKeyName.trim()}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {createMutation.isPending ? 'Creating...' : 'Create API Key'}
          </Button>
        </div>

        {createMutation.isError && (
          <div className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Failed to create API key
          </div>
        )}

        {/* Key List */}
        {keys.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No API keys yet. Create one to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-start justify-between rounded-lg border border-border/60 bg-muted/30 p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{key.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    sa_{key.key_prefix}...
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>Created: {formatDate(key.created_at)}</span>
                    <span>Last used: {formatDate(key.last_used_at)}</span>
                    <span>Requests: {key.request_count.toLocaleString()}</span>
                    <span>Expires: {key.expires_at ? formatDate(key.expires_at) : 'Never expires'}</span>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => revokeMutation.mutate(key.id)}
                  disabled={revokeMutation.isPending}
                  className="ml-3 shrink-0"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* One-time secret modal */}
      {newKeySecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-foreground">API Key Created</h2>

            <div className="mb-3 rounded-md bg-muted p-3 font-mono text-sm break-all text-foreground">
              {newKeySecret}
            </div>

            <Button
              onClick={handleCopy}
              variant="secondary"
              className="mb-3 w-full"
            >
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4 text-emerald-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </>
              )}
            </Button>

            <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              Make sure to copy your API key now. You won't be able to see it again!
            </p>

            <Button onClick={handleDismissModal} className="w-full">
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
