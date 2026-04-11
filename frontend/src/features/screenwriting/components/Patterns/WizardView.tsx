import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Wand2, CheckCircle2, AlertCircle, Sparkles, Check, CheckSquare, Square, Info } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, DEBOUNCE_DELAY } from '../../lib/constants';
import { FieldRenderer } from '../Shared/FieldRenderer';
import type { SubsectionConfig, TemplateConfig, ListItemResponse } from '../../types/template';

interface WizardViewProps {
  subsection: SubsectionConfig;
  projectId: string;
  phase: string;
  phaseData: any;
  templateConfig: TemplateConfig;
  withChat?: boolean;
  isImport?: boolean;
  onApplySuccess?: (key: string) => void;
}

export function WizardView({ subsection, projectId, phase, phaseData, templateConfig, withChat, isImport, onApplySuccess }: WizardViewProps) {
  const queryClient = useQueryClient();
  const wizardConfig = subsection.wizard_config;
  const approaches = wizardConfig?.approaches || [];
  const countOptions = wizardConfig?.count_options || [];
  const readinessChecks = wizardConfig?.readiness_checks || [];
  const maxSelectable = wizardConfig?.episode_selector_max || 10;

  const [selectedApproach, setSelectedApproach] = useState(approaches[0]?.key || '');
  const [selectedCount, setSelectedCount] = useState<string | number>(wizardConfig?.default_count || countOptions[0]?.value || '');
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [customGuidance, setCustomGuidance] = useState('');
  const [wizardRunId, setWizardRunId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  // Sync form data from phaseData (including AI action mode updates)
  useEffect(() => {
    if (phaseData?.content && !isSavingRef.current) {
      setFormData(phaseData.content as Record<string, string>);
    }
  }, [phaseData]);

  const fieldSaveMutation = useMutation({
    mutationFn: (content: Record<string, string>) =>
      api.updateSubsectionData(projectId, phase, subsection.key, content),
    onSuccess: () => {
      isSavingRef.current = false;
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SUBSECTION_DATA(projectId, phase, subsection.key) });
    },
    onError: () => {
      isSavingRef.current = false;
    },
  });

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFormData(prev => {
      const updated = { ...prev, [key]: value };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        isSavingRef.current = true;
        fieldSaveMutation.mutate(updated);
      }, DEBOUNCE_DELAY * 3);
      return updated;
    });
  }, [fieldSaveMutation]);

  const { data: readiness } = useQuery({
    queryKey: QUERY_KEYS.READINESS(projectId, phase),
    queryFn: () => api.getReadiness(projectId, phase),
    enabled: readinessChecks.length > 0,
  });

  const { data: wizardRun } = useQuery({
    queryKey: QUERY_KEYS.WIZARD_RUN(wizardRunId || ''),
    queryFn: () => api.getWizardRun(wizardRunId!),
    enabled: !!wizardRunId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && (data.status === 'completed' || data.status === 'failed') ? false : 2000;
    },
  });

  // ── Fetch Idea phase runtime_target ──────────────────────────────────
  const ideaSubsectionKey = useMemo(() => {
    if (!templateConfig) return null;
    for (const p of templateConfig.phases) {
      if (p.id === 'idea') {
        for (const sub of p.subsections) {
          if (sub.key === 'idea_wizard') return { phase: p.id, key: sub.key };
        }
      }
    }
    return null;
  }, [templateConfig]);

  const { data: ideaPhaseData } = useQuery({
    queryKey: QUERY_KEYS.SUBSECTION_DATA(projectId, ideaSubsectionKey?.phase || '', ideaSubsectionKey?.key || ''),
    queryFn: () => api.getSubsectionData(projectId, ideaSubsectionKey!.phase, ideaSubsectionKey!.key),
    enabled: !!ideaSubsectionKey,
  });

  const runtimeTarget = (ideaPhaseData?.content as Record<string, string>)?.runtime_target || '';

  // ── Episode/Scene selector: find source list ──────────────────────────
  const sourceList = useMemo(() => {
    if (!wizardConfig?.episode_selector || !templateConfig) return null;
    // Search all phases for an ordered_list subsection
    for (const p of templateConfig.phases) {
      for (const sub of p.subsections) {
        if (sub.ui_pattern === 'ordered_list') {
          return { phase: p.id, subsectionKey: sub.key, itemLabel: sub.list_config?.item_type || 'item' };
        }
      }
    }
    return null;
  }, [wizardConfig?.episode_selector, templateConfig]);

  // Fetch the PhaseData record for the source list (to get its id)
  const { data: sourcePhaseData } = useQuery({
    queryKey: QUERY_KEYS.SUBSECTION_DATA(projectId, sourceList?.phase || '', sourceList?.subsectionKey || ''),
    queryFn: () => api.getSubsectionData(projectId, sourceList!.phase, sourceList!.subsectionKey),
    enabled: !!sourceList,
  });

  // Fetch the actual list items
  const { data: sourceItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: QUERY_KEYS.LIST_ITEMS(sourcePhaseData?.id || ''),
    queryFn: () => api.getListItems(sourcePhaseData!.id),
    enabled: !!sourcePhaseData?.id,
  });

  const toggleItem = (id: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < maxSelectable) {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItemIds.size === sourceItems.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(sourceItems.slice(0, maxSelectable).map(i => i.id)));
    }
  };

  // ── Mutations ─────────────────────────────────────────────────────────
  const [runError, setRunError] = useState<string | null>(null);

  const runMutation = useMutation({
    mutationFn: () => {
      // Build episodes array from selected items
      const selectedEpisodes = sourceItems
        .filter(item => selectedItemIds.has(item.id))
        .map(item => item.content);

      const payload = {
        project_id: projectId,
        wizard_type: subsection.key,
        phase,
        config: {
          approach: selectedApproach,
          count: selectedCount,
          episodes: selectedEpisodes,
          runtime_target: runtimeTarget,
          custom_guidance: customGuidance,
          ...formData,
        },
      };
      console.log('[WizardView] runWizard payload:', JSON.stringify(payload, null, 2));
      return api.runWizard(payload);
    },
    onSuccess: (data) => {
      console.log('[WizardView] runWizard SUCCESS:', JSON.stringify(data, null, 2));
      setRunError(null);
      setWizardRunId(data.id);
    },
    onError: (err: Error) => {
      console.error('[WizardView] runWizard ERROR:', err.message, err);
      setRunError(err.message === 'Request timeout'
        ? 'Generation timed out. Try again — generating multiple screenplays may take up to 5 minutes.'
        : `Generation failed: ${err.message}`
      );
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => api.applyWizardResults(wizardRunId!),
    onSuccess: () => {
      setWizardRunId(null);
      if (subsection.key === 'script_writer_wizard') {
        onApplySuccess?.('screenplay_editor');
      }
    },
  });

  const isRunning = wizardRun?.status === 'pending' || wizardRun?.status === 'running';
  const isCompleted = wizardRun?.status === 'completed';
  const isFailed = wizardRun?.status === 'failed';

  // Auto-apply when wizard completes
  const hasAutoApplied = useRef(false);
  useEffect(() => {
    if (isCompleted && wizardRunId && !applyMutation.isPending && !hasAutoApplied.current) {
      hasAutoApplied.current = true;
      applyMutation.mutate();
    }
  }, [isCompleted, wizardRunId]);

  // Reset auto-apply flag when a new wizard run starts
  useEffect(() => {
    if (isRunning) {
      hasAutoApplied.current = false;
    }
  }, [isRunning]);

  // Disable generate if episode selector is active but nothing selected
  const needsEpisodes = wizardConfig?.episode_selector && sourceList;
  const canGenerate = !needsEpisodes || selectedItemIds.size > 0;
  const generateLabel = wizardConfig?.generate_button || 'Generate';

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h2 className="font-display text-2xl font-semibold text-foreground">{subsection.name}</h2>
        {subsection.description && (
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{subsection.description}</p>
        )}
      </div>

      {/* Import fields */}
      {isImport && subsection.fields && (
        <div className="space-y-4 mb-6">
          {subsection.fields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={customGuidance}
              onChange={(_, val) => setCustomGuidance(val)}
            />
          ))}
        </div>
      )}

      {/* Readiness Panel */}
      {readinessChecks.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 mb-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Readiness</h3>
          <div className="space-y-3">
            {readinessChecks.map((check) => {
              const score = readiness?.[`${check.phase}.${check.subsection_key}`] || 0;
              const total = check.field_count;
              const pct = total > 0 ? Math.round((score / total) * 100) : 0;

              return (
                <div key={check.label}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">{check.label}</span>
                    <span className={`font-mono ${pct >= 75 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                      {score}/{total}
                    </span>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct >= 75 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-muted-foreground/30'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Approach Selector */}
      {approaches.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Approach</h3>
          <div className="space-y-2">
            {approaches.map((approach) => {
              const isSelected = selectedApproach === approach.key;
              return (
                <button
                  key={approach.key}
                  onClick={() => setSelectedApproach(approach.key)}
                  className={`
                    w-full text-left p-4 rounded-xl border transition-all duration-200
                    ${isSelected
                      ? 'border-amber-500/30 bg-amber-500/5 glow-amber'
                      : 'border-border bg-card/50 hover:bg-card hover:border-muted-foreground/20'
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
                      isSelected ? 'border-amber-500 bg-amber-500' : 'border-muted-foreground/40'
                    }`}>
                      {isSelected && <div className="w-full h-full rounded-full bg-amber-500" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{approach.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{approach.description}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Count Selector */}
      {countOptions.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Scene Count</h3>
          <div className="flex gap-2 flex-wrap">
            {countOptions.map((option) => {
              const optionValue = typeof option === 'object' ? option.value : option;
              const optionLabel = typeof option === 'object' ? option.label : option;
              return (
                <button
                  key={optionValue}
                  onClick={() => setSelectedCount(optionValue)}
                  className={`
                    px-4 py-2 text-sm rounded-lg transition-all duration-200
                    ${selectedCount === optionValue
                      ? 'bg-amber-500 text-amber-950 font-semibold shadow-md shadow-amber-900/20'
                      : 'bg-card text-muted-foreground border border-border hover:border-muted-foreground/30 hover:text-foreground'
                    }
                  `}
                >
                  {optionLabel}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Runtime Target from Idea Phase */}
      {runtimeTarget && (
        <div className="mb-6 bg-card border border-amber-500/15 rounded-xl p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Target Runtime
              <span className="text-muted-foreground/60 font-normal normal-case tracking-normal ml-1">(from Idea)</span>
            </h3>
            <p className="text-sm text-foreground">{runtimeTarget}</p>
          </div>
        </div>
      )}

      {/* Episode/Scene Selector with per-scene durations */}
      {needsEpisodes && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Select {sourceList.itemLabel.replace('_', ' ')}s
              {selectedItemIds.size > 0 && (
                <span className="ml-2 text-amber-400 normal-case tracking-normal">
                  ({selectedItemIds.size}/{Math.min(sourceItems.length, maxSelectable)})
                </span>
              )}
            </h3>
            {sourceItems.length > 0 && (
              <button
                onClick={toggleAll}
                className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
              >
                {selectedItemIds.size === sourceItems.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {itemsLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading items...
            </div>
          ) : sourceItems.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No {sourceList.itemLabel.replace('_', ' ')}s found. Create them first using the{' '}
                {sourceList.itemLabel === 'scene' ? 'Scene' : 'Episode'} Wizard.
              </p>
            </div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto rounded-xl border border-border">
              {sourceItems.map((item: ListItemResponse, index: number) => {
                const isSelected = selectedItemIds.has(item.id);
                const summary = (item.content as Record<string, string>).summary || `${sourceList.itemLabel} ${index + 1}`;
                const atLimit = selectedItemIds.size >= maxSelectable && !isSelected;

                return (
                  <button
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    disabled={atLimit}
                    className={`
                      w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                      ${isSelected
                        ? 'bg-amber-500/10 text-foreground'
                        : atLimit
                          ? 'opacity-40 cursor-not-allowed text-muted-foreground'
                          : 'hover:bg-muted/30 text-muted-foreground hover:text-foreground'
                      }
                    `}
                  >
                    {isSelected
                      ? <CheckSquare className="h-4 w-4 text-amber-400 flex-shrink-0" />
                      : <Square className="h-4 w-4 flex-shrink-0" />
                    }
                    <span className="text-xs font-mono text-muted-foreground/60 w-5">{index + 1}</span>
                    <span className="truncate">{summary}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Custom Guidance */}
      {!isImport && (
        <div className="mb-8">
          <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Custom Guidance
            <span className="text-muted-foreground/60 font-normal normal-case tracking-normal ml-1">(optional)</span>
          </label>
          <textarea
            value={customGuidance}
            onChange={(e) => setCustomGuidance(e.target.value)}
            placeholder="Any additional direction for the AI..."
            rows={3}
            className="w-full bg-input border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 resize-y transition-all"
          />
        </div>
      )}

      {/* Wizard with chat fields */}
      {withChat && subsection.fields && (
        <div className="space-y-4 border-t border-border pt-6 mb-8">
          {subsection.fields.map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={formData[field.key] || ''}
              onChange={handleFieldChange}
            />
          ))}
          {/* Save status */}
          <div className="flex justify-end">
            <div className="flex items-center gap-1.5 text-xs">
              {fieldSaveMutation.isPending && <span className="text-muted-foreground animate-pulse-warm">Saving...</span>}
              {fieldSaveMutation.isSuccess && (
                <span className="flex items-center gap-1 text-emerald-400"><Check className="h-3 w-3" /> Saved</span>
              )}
              {fieldSaveMutation.isError && (
                <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" /> Failed</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Generate Button - only show for non-chat wizards or import mode */}
      {(isImport || !withChat) && (
        <button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending || isRunning || !canGenerate}
          className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 text-amber-950 font-semibold rounded-xl shadow-lg shadow-amber-900/20 hover:from-amber-400 hover:to-amber-500 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {runMutation.isPending || isRunning ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </span>
          ) : isImport ? (
            <span className="flex items-center justify-center gap-2">
              <Sparkles className="h-4 w-4" />
              Import & Align
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Wand2 className="h-4 w-4" />
              {generateLabel}
            </span>
          )}
        </button>
      )}

      {/* Run error (timeout, network, etc.) */}
      {runError && (
        <div className="mt-4 bg-destructive/5 border border-destructive/20 rounded-xl p-4 animate-fade-up">
          <span className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {runError}
          </span>
        </div>
      )}

      {/* Results */}
      {isCompleted && wizardRun && (
        <div className="mt-6 bg-card border border-emerald-500/20 rounded-xl p-5 animate-fade-up">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-2 text-sm font-medium text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Generation Complete
            </span>
            <button
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending}
              className="px-4 py-1.5 text-xs font-medium bg-emerald-500 text-emerald-950 rounded-lg hover:bg-emerald-400 transition-colors disabled:opacity-50"
            >
              {applyMutation.isPending ? 'Applying...' : 'Apply Results'}
            </button>
          </div>
          <pre className="text-xs text-muted-foreground max-h-48 overflow-y-auto whitespace-pre-wrap font-screenplay leading-relaxed">
            {JSON.stringify(wizardRun.result, null, 2)}
          </pre>
        </div>
      )}

      {isFailed && wizardRun && (
        <div className="mt-6 bg-destructive/5 border border-destructive/20 rounded-xl p-5 animate-fade-up">
          <span className="flex items-center gap-2 text-sm font-medium text-destructive mb-1">
            <AlertCircle className="h-4 w-4" />
            Generation Failed
          </span>
          <p className="text-sm text-destructive/80">{wizardRun.error_message || 'An error occurred'}</p>
        </div>
      )}
    </div>
  );
}
