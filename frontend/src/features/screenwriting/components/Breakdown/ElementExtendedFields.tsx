import { useState } from 'react';
import { ELEMENT_EXTENDED_FIELDS } from '../../lib/constants';
import type { BreakdownElement, BreakdownCategory } from '../../types';

interface ElementExtendedFieldsProps {
  element: BreakdownElement;
  onSave: (data: { metadata: Record<string, unknown> }) => void;
  isSaving: boolean;
}

export function ElementExtendedFields({ element, onSave, isSaving }: ElementExtendedFieldsProps) {
  const fields = ELEMENT_EXTENDED_FIELDS[element.category as BreakdownCategory];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const meta = (element.metadata || {}) as Record<string, string>;
    const initial: Record<string, string> = {};
    if (fields) {
      for (const field of fields) {
        initial[field.key] = meta[field.key] || '';
      }
    }
    return initial;
  });

  if (!fields || fields.length === 0) {
    return null;
  }

  const handleChange = (key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
  };

  const handleBlur = () => {
    const mergedMetadata = {
      ...(element.metadata as Record<string, string>),
      ...values,
    };
    onSave({ metadata: mergedMetadata });
  };

  const inputClassName =
    'w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber-400/50';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Details
        </h3>
        {isSaving && (
          <span className="text-xs text-muted-foreground/60 animate-pulse">Saving...</span>
        )}
      </div>
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {field.label}
          </label>
          {field.type === 'textarea' ? (
            <textarea
              rows={3}
              value={values[field.key] || ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              onBlur={handleBlur}
              className={`${inputClassName} resize-none`}
              placeholder={`Enter ${field.label.toLowerCase()}...`}
            />
          ) : (
            <input
              type="text"
              value={values[field.key] || ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              onBlur={handleBlur}
              className={inputClassName}
              placeholder={`Enter ${field.label.toLowerCase()}...`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
