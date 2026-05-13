import { useState } from 'react';
import { DURATION_PRESETS } from '../../lib/constants';

interface EpisodeDurationPickerProps {
  value: number | null;
  onChange: (value: number | null) => void;
}

export function EpisodeDurationPicker({ value, onChange }: EpisodeDurationPickerProps) {
  const isPreset = DURATION_PRESETS.some(p => p.value === value);
  const [showCustom, setShowCustom] = useState(!isPreset && value !== null);

  const selectValue = showCustom || (!isPreset && value !== null)
    ? '-1'
    : value === null
      ? ''
      : String(value);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value;
    if (selected === '') {
      onChange(null);
      setShowCustom(false);
    } else if (selected === '-1') {
      setShowCustom(true);
    } else {
      onChange(Number(selected));
      setShowCustom(false);
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = Number(e.target.value);
    if (e.target.value && !isNaN(num) && num >= 1) {
      onChange(num);
    }
  };

  const handleCustomBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const num = Number(e.target.value);
    if (!e.target.value || isNaN(num) || num < 1) {
      onChange(null);
      setShowCustom(false);
    }
  };

  const inputClassName = 'w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/40 transition-all';

  return (
    <div>
      <select
        value={selectValue}
        onChange={handleSelectChange}
        className={inputClassName}
      >
        <option value="">No duration set</option>
        {DURATION_PRESETS.map(preset => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </select>
      {(showCustom || (!isPreset && value !== null)) && (
        <div className="mt-2">
          <label className="block text-xs text-muted-foreground mb-1">
            Custom duration (minutes)
          </label>
          <input
            type="number"
            min={1}
            max={480}
            value={value ?? ''}
            onChange={handleCustomChange}
            onBlur={handleCustomBlur}
            className={inputClassName}
            placeholder="Enter minutes..."
          />
        </div>
      )}
    </div>
  );
}
