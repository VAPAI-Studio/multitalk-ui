// frontend/src/components/Editor/ReviewPanel.tsx

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, AlertCircle, Lightbulb, Loader2, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, ERROR_MESSAGES } from '../../lib/constants';
import { type Section, Framework } from '../../types';
import { Button } from '../UI/Button';

interface ReviewPanelProps {
  section: Section;
  framework: Framework;
  onClose: () => void;
}

export function ReviewPanel({ section, framework, onClose }: ReviewPanelProps) {
  const queryClient = useQueryClient();
  const [isReviewing, setIsReviewing] = useState(false);

  const reviewMutation = useMutation({
    mutationFn: () =>
      api.reviewSection({
        section_id: section.id,
        text: section.user_notes,
        framework
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PROJECTS] });
      setIsReviewing(false);
    },
    onError: () => {
      setIsReviewing(false);
    }
  });

  const handleReview = () => {
    setIsReviewing(true);
    reviewMutation.mutate();
  };

  return (
    <div className="w-96 border-l border-border bg-card/30 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="font-display text-sm font-semibold text-foreground">AI Review</h3>
        <button
          onClick={onClose}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {reviewMutation.isError && (
          <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs animate-fade-in">
            {ERROR_MESSAGES.GENERIC}
          </div>
        )}
        {isReviewing ? (
          <div className="flex flex-col items-center justify-center h-64 animate-fade-in">
            <Loader2 className="h-6 w-6 animate-spin text-amber-500/60 mb-4" />
            <p className="text-xs text-muted-foreground">Analyzing your story...</p>
          </div>
        ) : (
          <>
            {!(section.ai_suggestions?.issues?.length) && !(section.ai_suggestions?.suggestions?.length) ? (
              <div className="text-center py-12 animate-fade-up">
                <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="h-5 w-5 text-amber-400" />
                </div>
                <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                  Get AI-powered feedback on this section of your screenplay
                </p>
                <Button onClick={handleReview} className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Get AI Review
                </Button>
              </div>
            ) : (
              <div className="space-y-6 animate-fade-in">
                {(section.ai_suggestions?.issues?.length || 0) > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                      Potential Issues
                    </h4>
                    <ul className="space-y-2">
                      {section.ai_suggestions.issues.map((issue, index) => (
                        <li
                          key={index}
                          className="text-xs text-foreground/80 bg-amber-500/5 border border-amber-500/10 p-3 rounded-xl leading-relaxed animate-fade-up"
                          style={{ animationDelay: `${index * 80}ms` }}
                        >
                          {issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(section.ai_suggestions?.suggestions?.length || 0) > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Lightbulb className="h-3.5 w-3.5 text-emerald-400" />
                      Suggestions
                    </h4>
                    <ul className="space-y-2">
                      {section.ai_suggestions.suggestions.map((suggestion, index) => (
                        <li
                          key={index}
                          className="text-xs text-foreground/80 bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl leading-relaxed animate-fade-up"
                          style={{ animationDelay: `${index * 80}ms` }}
                        >
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button onClick={handleReview} className="w-full gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Update Review
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
