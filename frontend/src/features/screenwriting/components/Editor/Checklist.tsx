import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { api } from '../../lib/api';
import { type Section, ChecklistStatus } from '../../types';
import { CHECKLIST_PROMPTS } from '../../lib/section-config';
import { QUERY_KEYS } from '../../lib/constants';

interface ChecklistProps {
  section: Section;
}

export function Checklist({ section }: ChecklistProps) {
  const queryClient = useQueryClient();
  const prompts = CHECKLIST_PROMPTS[section.type] || [];

  const updateChecklistMutation = useMutation({
    mutationFn: ({ itemId, answer }: { itemId: string; answer: string }) =>
      api.updateChecklistItem(itemId, {
        answer,
        status: answer ? ChecklistStatus.COMPLETE : ChecklistStatus.PENDING
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PROJECTS] });
    }
  });

  const handleAnswerChange = (itemId: string, answer: string) => {
    updateChecklistMutation.mutate({ itemId, answer });
  };

  const existingItems = section.checklist_items || [];
  const itemsMap = new Map(existingItems.map(item => [item.prompt, item]));

  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Story Development
      </h3>
      <div className="space-y-5">
        {prompts.map((prompt) => {
          const item = itemsMap.get(prompt);

          return (
            <div key={prompt} className="space-y-2">
              <div className="flex items-start gap-2">
                {item?.status === ChecklistStatus.COMPLETE ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
                )}
                <label className="text-xs font-medium text-foreground/80 leading-relaxed">
                  {prompt}
                </label>
              </div>
              <textarea
                value={item?.answer || ''}
                onChange={(e) => item && handleAnswerChange(item.id, e.target.value)}
                placeholder="Your answer..."
                className="w-full min-h-[52px] ml-6 bg-input border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 resize-y transition-all"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
