import type { VariableConfig, SectionConfig } from '../lib/builderUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FormValues = Record<string, string | number | boolean | File | null>;

interface DynamicFormRendererProps {
  variableConfig: VariableConfig[];
  sectionConfig: SectionConfig[];
  formValues: FormValues;
  onValueChange: (placeholderKey: string, value: string | number | boolean | File | null) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapTo32(n: number): number {
  return Math.round(n / 32) * 32 || 32;
}

// ---------------------------------------------------------------------------
// Individual Input Widgets
// ---------------------------------------------------------------------------

function TextInput({
  v,
  value,
  onChange,
  disabled,
}: {
  v: VariableConfig;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      id={v.placeholder_key}
      placeholder={v.placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}

function TextareaInput({
  v,
  value,
  onChange,
  disabled,
}: {
  v: VariableConfig;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  return (
    <textarea
      id={v.placeholder_key}
      placeholder={v.placeholder}
      rows={3}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 resize-vertical disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}

function NumberInput({
  v,
  value,
  onChange,
  disabled,
}: {
  v: VariableConfig;
  value: number | string;
  onChange: (val: number) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      id={v.placeholder_key}
      placeholder={v.placeholder}
      min={v.min}
      max={v.max}
      step={v.step ?? 1}
      value={value as number}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={disabled}
      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}

function SliderInput({
  v,
  value,
  onChange,
  disabled,
}: {
  v: VariableConfig;
  value: number;
  onChange: (val: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        id={v.placeholder_key}
        min={v.min ?? 0}
        max={v.max ?? 100}
        step={v.step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="flex-1 accent-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <span className="w-16 text-right text-gray-800 font-medium tabular-nums">{value}</span>
    </div>
  );
}

function FileInput({
  v,
  value,
  onChange,
  disabled,
  accept,
}: {
  v: VariableConfig;
  value: File | null;
  onChange: (val: File | null) => void;
  disabled?: boolean;
  accept: string;
}) {
  return (
    <div>
      <input
        type="file"
        id={v.placeholder_key}
        accept={v.accept || accept}
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {value && (
        <p className="text-xs text-gray-500 mt-1">Selected: {value.name}</p>
      )}
      <p className="text-xs text-gray-400 mt-1">Accepted: {v.accept || accept}</p>
    </div>
  );
}

function DropdownInput({
  v,
  value,
  onChange,
  disabled,
}: {
  v: VariableConfig;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  const options = v.options ?? [];
  return (
    <select
      id={v.placeholder_key}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {!value && <option value="">Select an option…</option>}
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

function ToggleInput({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        value ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          value ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function ResolutionInput({
  v,
  valueW,
  valueH,
  onChangeW,
  onChangeH,
  disabled,
}: {
  v: VariableConfig;
  valueW: number;
  valueH: number;
  onChangeW: (val: number) => void;
  onChangeH: (val: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label htmlFor={`${v.placeholder_key}_W`} className="block text-xs font-medium text-gray-600 mb-1">
          Width (px)
        </label>
        <input
          type="number"
          id={`${v.placeholder_key}_W`}
          value={valueW}
          step={32}
          min={32}
          onChange={(e) => onChangeW(Number(e.target.value))}
          onBlur={(e) => onChangeW(snapTo32(Number(e.target.value)))}
          disabled={disabled}
          className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
      <div>
        <label htmlFor={`${v.placeholder_key}_H`} className="block text-xs font-medium text-gray-600 mb-1">
          Height (px)
        </label>
        <input
          type="number"
          id={`${v.placeholder_key}_H`}
          value={valueH}
          step={32}
          min={32}
          onChange={(e) => onChangeH(Number(e.target.value))}
          onBlur={(e) => onChangeH(snapTo32(Number(e.target.value)))}
          disabled={disabled}
          className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
      <p className="col-span-2 text-xs text-gray-400">Values snap to multiples of 32 on blur</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VariableField — renders one variable with label + widget + help text
// ---------------------------------------------------------------------------

function VariableField({
  v,
  formValues,
  onValueChange,
  disabled,
}: {
  v: VariableConfig;
  formValues: FormValues;
  onValueChange: (key: string, value: string | number | boolean | File | null) => void;
  disabled?: boolean;
}) {
  const rawVal = formValues[v.placeholder_key];
  const strVal = typeof rawVal === 'string' ? rawVal : String(rawVal ?? v.default_value ?? '');
  const numVal = typeof rawVal === 'number' ? rawVal : Number(rawVal ?? v.default_value ?? 0);
  const boolVal = typeof rawVal === 'boolean' ? rawVal : Boolean(rawVal ?? v.default_value ?? false);
  const fileVal = rawVal instanceof File ? rawVal : null;

  const wKey = v.placeholder_key + '_W';
  const hKey = v.placeholder_key + '_H';
  const wRaw = formValues[wKey];
  const hRaw = formValues[hKey];
  const wVal = typeof wRaw === 'number' ? wRaw : Number(wRaw ?? v.default_value ?? 512);
  const hVal = typeof hRaw === 'number' ? hRaw : Number(hRaw ?? v.default_value ?? 512);

  let widget: React.ReactNode;

  switch (v.type) {
    case 'text':
      widget = (
        <TextInput
          v={v}
          value={strVal}
          onChange={(val) => onValueChange(v.placeholder_key, val)}
          disabled={disabled}
        />
      );
      break;

    case 'textarea':
      widget = (
        <TextareaInput
          v={v}
          value={strVal}
          onChange={(val) => onValueChange(v.placeholder_key, val)}
          disabled={disabled}
        />
      );
      break;

    case 'number':
      widget = (
        <NumberInput
          v={v}
          value={numVal}
          onChange={(val) => onValueChange(v.placeholder_key, val)}
          disabled={disabled}
        />
      );
      break;

    case 'slider':
      widget = (
        <SliderInput
          v={v}
          value={numVal}
          onChange={(val) => onValueChange(v.placeholder_key, val)}
          disabled={disabled}
        />
      );
      break;

    case 'file-image':
      widget = (
        <FileInput
          v={v}
          value={fileVal}
          onChange={(val) => onValueChange(v.placeholder_key, val)}
          disabled={disabled}
          accept="image/*"
        />
      );
      break;

    case 'file-audio':
      widget = (
        <FileInput
          v={v}
          value={fileVal}
          onChange={(val) => onValueChange(v.placeholder_key, val)}
          disabled={disabled}
          accept="audio/*"
        />
      );
      break;

    case 'file-video':
      widget = (
        <FileInput
          v={v}
          value={fileVal}
          onChange={(val) => onValueChange(v.placeholder_key, val)}
          disabled={disabled}
          accept="video/*"
        />
      );
      break;

    case 'dropdown':
      widget = (
        <DropdownInput
          v={v}
          value={strVal}
          onChange={(val) => onValueChange(v.placeholder_key, val)}
          disabled={disabled}
        />
      );
      break;

    case 'toggle':
      widget = (
        <ToggleInput
          value={boolVal}
          onChange={(val) => onValueChange(v.placeholder_key, val)}
          disabled={disabled}
        />
      );
      break;

    case 'resolution':
      widget = (
        <ResolutionInput
          v={v}
          valueW={wVal}
          valueH={hVal}
          onChangeW={(val) => onValueChange(wKey, val)}
          onChangeH={(val) => onValueChange(hKey, val)}
          disabled={disabled}
        />
      );
      break;

    default:
      widget = <span className="text-xs text-red-500">Unknown input type: {v.type}</span>;
  }

  return (
    <div className="mb-4">
      <label htmlFor={v.placeholder_key} className="block text-sm font-semibold text-gray-800 mb-2">
        {v.label}
        {v.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {widget}
      {v.help_text && (
        <p className="text-xs text-gray-500 mt-1.5">{v.help_text}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DynamicFormRenderer — groups variables into sections and renders them
// ---------------------------------------------------------------------------

export function DynamicFormRenderer({
  variableConfig,
  sectionConfig,
  formValues,
  onValueChange,
  disabled = false,
}: DynamicFormRendererProps) {
  // Sort variables by order ascending
  const sortedVars = [...variableConfig].sort((a, b) => a.order - b.order);

  // Sort sections by order ascending
  const sortedSections = [...sectionConfig].sort((a, b) => a.order - b.order);

  // Build groups: one per section, plus "Other" for unsectioned vars
  const sectionIds = new Set(sortedSections.map((s) => s.id));

  const groups: Array<{ id: string; name: string | null; vars: VariableConfig[] }> = sortedSections.map(
    (sec) => ({
      id: sec.id,
      name: sec.name,
      vars: sortedVars.filter((v) => v.section_id === sec.id),
    }),
  );

  // "Other" group: vars with no section_id or section_id not in known sections
  const otherVars = sortedVars.filter(
    (v) => !v.section_id || !sectionIds.has(v.section_id),
  );

  if (otherVars.length > 0) {
    groups.push({ id: '__other__', name: null, vars: otherVars });
  }

  // Filter out empty groups
  const filledGroups = groups.filter((g) => g.vars.length > 0);

  if (filledGroups.length === 0) {
    return (
      <p className="text-gray-400 italic text-sm">No variables to display.</p>
    );
  }

  return (
    <div className="space-y-6">
      {filledGroups.map((group) => (
        <div
          key={group.id}
          className="rounded-3xl border border-gray-200/80 p-6 shadow-lg bg-white/80"
        >
          {group.name && (
            <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <div className="w-1.5 h-6 bg-gradient-to-b from-blue-500 to-purple-600 rounded-full" />
              {group.name}
            </h2>
          )}
          {group.vars.map((v) => (
            <VariableField
              key={v.id}
              v={v}
              formValues={formValues}
              onValueChange={onValueChange}
              disabled={disabled}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default DynamicFormRenderer;
