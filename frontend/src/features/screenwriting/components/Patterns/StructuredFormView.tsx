import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, DEBOUNCE_DELAY } from '../../lib/constants';
import { FieldRenderer } from '../Shared/FieldRenderer';
import type { SubsectionConfig, PhaseDataResponse, TemplateConfig } from '../../types/template';

interface StructuredFormViewProps {
  subsection: SubsectionConfig;
  projectId: string;
  phase: string;
  phaseData: PhaseDataResponse | null;
  templateConfig: TemplateConfig;
}

export function StructuredFormView({ subsection, projectId, phase, phaseData }: StructuredFormViewProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

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

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFormData(prev => {
      const updated = { ...prev, [key]: value };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        isSavingRef.current = true;
        saveMutation.mutate(updated);
      }, DEBOUNCE_DELAY * 3);
      return updated;
    });
  }, [saveMutation]);

  const fieldGroups = subsection.field_groups || [];

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h2 className="font-display text-2xl font-semibold text-foreground">{subsection.name}</h2>
        {subsection.description && (
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{subsection.description}</p>
        )}
      </div>

      {/* Field Groups */}
      <div className="space-y-10">
        {fieldGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="animate-fade-up" style={{ animationDelay: `${groupIndex * 80}ms`, animationFillMode: 'both' }}>
            {group.label && (
              <div className="mb-5">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">{group.label}</h3>
                {group.description && (
                  <p className="text-xs text-muted-foreground mt-1">{group.description}</p>
                )}
                <div className="mt-3 h-px bg-gradient-to-r from-border to-transparent" />
              </div>
            )}

            <div className="space-y-5">
              {group.fields.map((field) => (
                <FieldRenderer
                  key={field.key}
                  field={field}
                  value={formData[field.key] || ''}
                  onChange={handleFieldChange}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Save status */}
      <div className="mt-6 flex justify-end">
        <div className="flex items-center gap-1.5 text-xs">
          {saveMutation.isPending && (
            <span className="text-muted-foreground animate-pulse-warm">Saving...</span>
          )}
          {saveMutation.isSuccess && (
            <span className="flex items-center gap-1 text-emerald-400">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
          {saveMutation.isError && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3 w-3" /> Failed to save
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
