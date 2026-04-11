import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Tv, Film } from 'lucide-react';
import { api } from '../../lib/api';
import { Framework } from '../../types';
import type { TemplateListItem } from '../../types/template';
import { Button } from '../UI/Button';
import { FRAMEWORK_LABELS } from '../../lib/section-config';
import { QUERY_KEYS } from '../../lib/constants';

const TEMPLATE_ICON_MAP: Record<string, typeof Tv> = {
  tv: Tv,
  film: Film,
};

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ProjectMode = 'template' | 'legacy';

export function CreateProjectModal({ open, onOpenChange }: CreateProjectModalProps) {
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<ProjectMode>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [framework, setFramework] = useState<Framework>(Framework.THREE_ACT);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: [QUERY_KEYS.TEMPLATES],
    queryFn: () => api.getTemplates(),
  });

  const createV2Mutation = useMutation({
    mutationFn: api.createProjectV2,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PROJECTS] });
      onOpenChange(false);
      setTitle('');
      setSelectedTemplate('');
      navigate(`/projects/${project.id}/idea`);
    }
  });

  const createLegacyMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PROJECTS] });
      onOpenChange(false);
      setTitle('');
      setFramework(Framework.THREE_ACT);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'template') {
      createV2Mutation.mutate({ title, template: selectedTemplate });
    } else {
      createLegacyMutation.mutate({ title, framework });
    }
  };

  const isPending = createV2Mutation.isPending || createLegacyMutation.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[90vw] max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card border border-border p-0 shadow-2xl shadow-black/40 data-[state=open]:animate-scale-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <Dialog.Title className="font-display text-xl font-semibold text-foreground">
              New Project
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-5">
            {/* Title */}
            <div>
              <label htmlFor="title" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/40 transition-all"
                placeholder="My Screenplay"
                required
                autoFocus
              />
            </div>

            {/* Mode Toggle */}
            <div className="flex bg-muted/40 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setMode('template')}
                className={`flex-1 py-2 px-3 text-xs font-medium rounded-md transition-all duration-200
                  ${mode === 'template'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                Templates
              </button>
              <button
                type="button"
                onClick={() => setMode('legacy')}
                className={`flex-1 py-2 px-3 text-xs font-medium rounded-md transition-all duration-200
                  ${mode === 'legacy'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                Classic
              </button>
            </div>

            {/* Template Selection */}
            {mode === 'template' && (
              <div className="space-y-2.5">
                {templates.map((tmpl: TemplateListItem) => {
                  const isSelected = selectedTemplate === tmpl.id;
                  const Icon = TEMPLATE_ICON_MAP[tmpl.icon] || Film;

                  return (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => setSelectedTemplate(tmpl.id)}
                      className={`w-full text-left flex items-center gap-4 p-4 rounded-xl border transition-all duration-200
                        ${isSelected
                          ? 'border-amber-500/40 bg-amber-500/5 glow-amber'
                          : 'border-border hover:border-muted-foreground/20 hover:bg-muted/30'
                        }`}
                    >
                      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors
                        ${isSelected ? 'bg-amber-500/15 text-amber-400' : 'bg-muted text-muted-foreground'}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground">{tmpl.name}</div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{tmpl.description}</p>
                      </div>
                      {isSelected && (
                        <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Legacy Framework Selection */}
            {mode === 'legacy' && (
              <div>
                <label htmlFor="framework" className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Framework
                </label>
                <select
                  id="framework"
                  value={framework}
                  onChange={(e) => setFramework(e.target.value as Framework)}
                  className="w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/40 transition-all"
                >
                  {Object.entries(FRAMEWORK_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2.5 pt-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!title || isPending || (mode === 'template' && !selectedTemplate)}
              >
                {isPending ? 'Creating...' : 'Create Project'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
