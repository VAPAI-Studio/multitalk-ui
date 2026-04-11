import type { FieldDef } from '../../types/template';

interface FieldRendererProps {
  field: FieldDef;
  value: string;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

export function FieldRenderer({ field, value, onChange, disabled }: FieldRendererProps) {
  const inputClasses = 'w-full bg-input border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 transition-all disabled:opacity-40';

  if (field.type === 'select' && field.options) {
    return (
      <div>
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{field.label}</label>
        <select
          value={value || ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          className={inputClasses}
          disabled={disabled}
        >
          <option value="">{field.placeholder || 'Select...'}</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div>
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{field.label}</label>
        <textarea
          value={value || ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className={`${inputClasses} resize-y min-h-[100px]`}
          disabled={disabled}
          maxLength={field.max_length}
        />
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{field.label}</label>
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        value={value || ''}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        className={inputClasses}
        disabled={disabled}
        maxLength={field.max_length}
      />
    </div>
  );
}
