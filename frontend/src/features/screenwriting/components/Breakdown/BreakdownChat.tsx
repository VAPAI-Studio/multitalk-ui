import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Send, RotateCcw, Loader2, AlertCircle, MessageSquare } from 'lucide-react';
import { MarkdownContent } from '../Shared/MarkdownContent';
import { ShotProposalCard } from './ShotProposalCard';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { Shot, BreakdownElement, BreakdownChatMessage, ShotAction } from '../../types';

interface BreakdownChatProps {
  projectId: string;
}

export function BreakdownChat({ projectId }: BreakdownChatProps) {
  const [messages, setMessages] = useState<BreakdownChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [shotAction, setShotAction] = useState<ShotAction | null>(null);
  const streamingTextRef = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

  const buildBreakdownContext = useCallback(() => {
    const shots = queryClient.getQueryData<Shot[]>(QUERY_KEYS.SHOTS(projectId)) || [];
    const elements = queryClient.getQueryData<BreakdownElement[]>(
      QUERY_KEYS.BREAKDOWN_ELEMENTS(projectId)
    ) || [];
    return {
      shots: shots.map(s => ({
        id: s.id,
        shot_number: s.shot_number,
        scene_item_id: s.scene_item_id,
        fields: s.fields,
        source: s.source,
      })),
      elements: elements.map(e => ({
        id: e.id,
        category: e.category,
        name: e.name,
        description: e.description,
      })),
    };
  }, [projectId, queryClient]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const content = input.trim();
    setInput('');
    setIsStreaming(true);
    setStreamingText('');
    setErrorText('');
    streamingTextRef.current = '';

    const userMessage: BreakdownChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);

    const breakdownContext = buildBreakdownContext();

    try {
      await api.sendBreakdownChatStream(
        projectId,
        content,
        messages.map(m => ({ role: m.role, content: m.content })),
        breakdownContext,
        (chunk) => {
          streamingTextRef.current += chunk;
          setStreamingText(prev => prev + chunk);
        },
        (data) => {
          if (data.shot_action) setShotAction(data.shot_action);
        },
      );
    } catch (err) {
      setErrorText(
        err instanceof Error ? err.message : 'Something went wrong. Try sending your message again.'
      );
    } finally {
      if (streamingTextRef.current) {
        setMessages(prev => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: streamingTextRef.current,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      setStreamingText('');
      setIsStreaming(false);
      textareaRef.current?.focus();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setShotAction(null);
    setStreamingText('');
    setErrorText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };

  const getExistingShots = useCallback((): Shot[] => {
    return queryClient.getQueryData<Shot[]>(QUERY_KEYS.SHOTS(projectId)) || [];
  }, [projectId, queryClient]);

  const handleShotConfirmed = useCallback((confirmationMessage: string) => {
    // Add confirmation message to chat
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'assistant',
      content: confirmationMessage,
      created_at: new Date().toISOString(),
    }]);
    setShotAction(null);
  }, []);

  const handleShotDismiss = useCallback(() => {
    setShotAction(null);
  }, []);

  // Auto-scroll to bottom on new messages / streaming
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [messages, streamingText, shotAction]);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div
        className="px-3 py-2 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid hsl(var(--border))' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Breakdown AI
        </span>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Clear conversation"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Message area */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-3"
        role="log"
        aria-live="polite"
      >
        {/* Empty state */}
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center animate-fade-in">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">Breakdown assistant</p>
            <p className="text-xs text-muted-foreground/60 max-w-[200px]">
              Ask about your shotlist, breakdown elements, or request new shots. The AI has context about your entire project.
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.map(msg =>
          msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end animate-fade-up">
              <div className="max-w-[85%] rounded-xl px-3 py-2 bg-primary/15 border border-primary/10">
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: 'hsl(210 20% 92%)' }}
                >
                  {msg.content}
                </p>
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex justify-start animate-fade-up">
              <div className="max-w-[85%] rounded-xl px-3 py-2 bg-muted/50 border border-border">
                <MarkdownContent
                  content={msg.content}
                  className="text-sm leading-relaxed text-foreground/80"
                />
              </div>
            </div>
          )
        )}

        {/* Streaming bubble */}
        {isStreaming && streamingText && (
          <div className="flex justify-start animate-fade-up">
            <div className="max-w-[85%] rounded-xl px-3 py-2 bg-muted/50 border border-border">
              <MarkdownContent
                content={streamingText}
                className="text-sm leading-relaxed text-foreground/80"
              />
            </div>
          </div>
        )}

        {/* Loading spinner */}
        {isStreaming && !streamingText && (
          <div className="flex justify-start animate-fade-up">
            <div className="max-w-[85%] rounded-xl px-3 py-2 bg-muted/50 border border-border">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        {/* Error bubble */}
        {errorText && (
          <div className="flex justify-start animate-fade-up">
            <div className="max-w-[85%] rounded-xl px-3 py-2 bg-destructive/10 border border-destructive/20 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{errorText}</p>
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Shot proposal confirmation card */}
      {shotAction && (
        <ShotProposalCard
          projectId={projectId}
          action={shotAction}
          existingShots={getExistingShots()}
          onDismiss={handleShotDismiss}
          onConfirmed={handleShotConfirmed}
        />
      )}

      {/* Input area */}
      <div
        className="p-3 flex-shrink-0 flex gap-2 items-end"
        style={{ borderTop: '1px solid hsl(var(--border))' }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your shotlist..."
          disabled={isStreaming}
          rows={1}
          className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ maxHeight: '120px' }}
        />
        <button
          onClick={handleSend}
          disabled={isStreaming || !input.trim()}
          className="px-3 py-2 bg-primary text-primary-foreground rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
