import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, AlertCircle, ChevronDown, Wand2, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, DEBOUNCE_DELAY } from '../../lib/constants';
import type { SubsectionConfig, PhaseDataResponse, TemplateConfig } from '../../types/template';

interface CardGridViewProps {
  subsection: SubsectionConfig;
  projectId: string;
  phase: string;
  phaseData: PhaseDataResponse | null;
  templateConfig: TemplateConfig;
}

export function CardGridView({ subsection, projectId, phase, phaseData }: CardGridViewProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [fillingKey, setFillingKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formDataRef = useRef(formData);
  const isSavingRef = useRef(false);

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  useEffect(() => {
    if (phaseData?.content && !isSavingRef.current) {
      setFormData(phaseData.content as Record<string, string>);
    }
  }, [phaseData]);

  const saveMutation = useMutation({
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

  const autofillMutation = useMutation({
    mutationFn: (fieldKey: string) =>
      api.fillBlanks({ project_id: projectId, phase, subsection_key: subsection.key, field_key: fieldKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SUBSECTION_DATA(projectId, phase, subsection.key) });
      setFillingKey(null);
    },
    onError: () => {
      setFillingKey(null);
    },
  });

  const handleChange = useCallback((key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isSavingRef.current = true;
      saveMutation.mutate({ ...formDataRef.current, [key]: value });
    }, DEBOUNCE_DELAY * 3);
  }, [saveMutation]);

  const handleAutofill = useCallback((fieldKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFillingKey(fieldKey);
    autofillMutation.mutate(fieldKey);
  }, [autofillMutation]);

  const fields = subsection.fields || subsection.cards || [];
  const columns = subsection.columns || subsection.grid_columns || 3;

  return (
    <div className="p-8 animate-fade-in">
      {/* Header */}
      <div className="mb-8 max-w-3xl">
        <h2 className="font-display text-2xl font-semibold text-foreground">{subsection.name}</h2>
        {subsection.description && (
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{subsection.description}</p>
        )}
      </div>

      {/* Card Grid */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {fields.map((field, index) => {
          const isExpanded = expandedCard === field.key;
          const hasContent = !!formData[field.key];
          const isFilling = fillingKey === field.key;

          return (
            <div
              key={field.key}
              className={`
                group rounded-xl border transition-all duration-200 cursor-pointer
                ${isExpanded
                  ? 'border-amber-500/30 bg-card glow-amber col-span-full'
                  : hasContent
                    ? 'border-border bg-card hover:border-amber-500/20'
                    : 'border-border/60 bg-card/50 hover:border-border hover:bg-card'
                }
              `}
              style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
              onClick={() => setExpandedCard(isExpanded ? null : field.key)}
            >
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-foreground">{field.label}</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => handleAutofill(field.key, e)}
                      disabled={isFilling}
                      title="Autofill with AI"
                      className="p-1 rounded-md text-muted-foreground/50 hover:text-amber-400 hover:bg-amber-500/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-100"
                    >
                      {isFilling ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                      ) : (
                        <Wand2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {hasContent && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    )}
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {isExpanded ? (
                  <textarea
                    value={formData[field.key] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={field.placeholder}
                    rows={5}
                    className="w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 resize-y mt-1 transition-all"
                    autoFocus
                  />
                ) : (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {formData[field.key] || field.placeholder || 'Click to edit...'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Save status */}
      <div className="mt-6 flex justify-end">
        <div className="flex items-center gap-1.5 text-xs">
          {saveMutation.isPending && <span className="text-muted-foreground animate-pulse-warm">Saving...</span>}
          {saveMutation.isSuccess && (
            <span className="flex items-center gap-1 text-emerald-400"><Check className="h-3 w-3" /> Saved</span>
          )}
          {saveMutation.isError && (
            <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" /> Failed</span>
          )}
        </div>
      </div>
    </div>
  );
}
