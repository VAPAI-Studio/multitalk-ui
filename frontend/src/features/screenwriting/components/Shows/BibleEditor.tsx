import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { BIBLE_SECTIONS } from '../../lib/constants';
import type { BibleResponse, BibleUpdate } from '../../types';
import { EpisodeDurationPicker } from './EpisodeDurationPicker';

interface BibleEditorProps {
  showId: string;
  bible: BibleResponse;
}

export function BibleEditor({ showId, bible }: BibleEditorProps) {
  const [values, setValues] = useState<Record<string, string>>({
    bible_characters: bible.bible_characters,
    bible_world_setting: bible.bible_world_setting,
    bible_season_arc: bible.bible_season_arc,
    bible_tone_style: bible.bible_tone_style,
  });

  const [duration, setDuration] = useState<number | null>(bible.episode_duration_minutes);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    bible_characters: true,
    bible_world_setting: false,
    bible_season_arc: false,
    bible_tone_style: false,
  });

  const [savedField, setSavedField] = useState<string | null>(null);

  // Initialize from bible props on mount only -- avoid overwriting local edits on query refetch
  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current) {
      setValues({
        bible_characters: bible.bible_characters,
        bible_world_setting: bible.bible_world_setting,
        bible_season_arc: bible.bible_season_arc,
        bible_tone_style: bible.bible_tone_style,
      });
      setDuration(bible.episode_duration_minutes);
      loaded.current = true;
    }
  }, [bible]);

  const updateBibleMutation = useMutation({
    mutationFn: (data: Partial<BibleUpdate>) => api.updateBible(showId, data),
    onSuccess: (_data, variables) => {
      const field = Object.keys(variables)[0];
      setSavedField(field);
      setTimeout(() => setSavedField(null), 2000);
    },
  });

  const handleBlur = (key: string) => {
    updateBibleMutation.mutate({ [key]: values[key] });
  };

  const handleDurationChange = (val: number | null) => {
    setDuration(val);
    updateBibleMutation.mutate({ episode_duration_minutes: val });
  };

  return (
    <div className="space-y-3">
      {BIBLE_SECTIONS.map((section) => (
        <div key={section.key} className="border border-border rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setExpanded(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
          >
            <span>{section.label}</span>
            <div className="flex items-center gap-2">
              {savedField === section.key && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <Check className="h-3 w-3" /> Saved
                </span>
              )}
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded[section.key] ? 'rotate-180' : ''}`} />
            </div>
          </button>
          {expanded[section.key] && (
            <div className="px-4 pb-4">
              <textarea
                value={values[section.key] || ''}
                onChange={(e) => setValues(prev => ({ ...prev, [section.key]: e.target.value }))}
                onBlur={() => handleBlur(section.key)}
                placeholder={section.placeholder}
                rows={6}
                className="w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/40 transition-all resize-y min-h-[120px]"
              />
            </div>
          )}
        </div>
      ))}

      {/* Episode Duration */}
      <div className="border border-border rounded-xl px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-foreground">Episode Duration</span>
          {savedField === 'episode_duration_minutes' && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
        </div>
        <EpisodeDurationPicker value={duration} onChange={handleDurationChange} />
      </div>
    </div>
  );
}
