import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { type Section, Framework } from '../../types';
import { Button } from '../UI/Button';
import { Checklist } from './Checklist';
import { SECTION_LABELS } from '../../lib/section-config';
import { QUERY_KEYS } from '../../lib/constants';

interface SectionEditorProps {
  section: Section;
  framework: Framework;
  onRequestReview: () => void;
}

export function SectionEditor({ section, framework: _framework, onRequestReview }: SectionEditorProps) {
  const [notes, setNotes] = useState(section.user_notes);
  const queryClient = useQueryClient();

  useEffect(() => {
    setNotes(section.user_notes);
  }, [section.id, section.user_notes]);

  const updateSectionMutation = useMutation({
    mutationFn: (userNotes: string) =>
      api.updateSection(section.id, { user_notes: userNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PROJECTS] });
    }
  });

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value);
  };

  const handleBlur = () => {
    if (notes !== section.user_notes) {
      updateSectionMutation.mutate(notes);
    }
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      <div className="border-b border-border bg-card/30 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">{SECTION_LABELS[section.type]}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Develop this key plot point in your story
            </p>
          </div>
          <div className="flex items-center gap-3">
            {(section.ai_suggestions?.issues?.length || 0) > 0 && (
              <div className="flex items-center gap-1.5 text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">{section.ai_suggestions.issues.length} issues</span>
              </div>
            )}
            <Button onClick={onRequestReview} size="sm" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Review
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 p-6">
          <textarea
            value={notes}
            onChange={handleNotesChange}
            onBlur={handleBlur}
            placeholder="Write your notes for this section..."
            className="w-full h-full resize-none bg-input border border-border rounded-xl px-4 py-3 text-sm text-foreground leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 transition-all"
          />
        </div>

        <div className="w-80 border-l border-border bg-card/20 p-5 overflow-y-auto">
          <Checklist section={section} />
        </div>
      </div>
    </div>
  );
}
