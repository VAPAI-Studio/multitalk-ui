import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Send, Loader2, Lightbulb,
  ChevronDown, Sparkles
} from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, STORAGE_KEYS } from '../../lib/constants';
import { ResizablePanel } from '../UI/ResizablePanel';
import { MarkdownContent } from '../Shared/MarkdownContent';
import { type Section, Framework, type Agent, type ChatMessage, type BookReference, type ConsultedAgent } from '../../types';
import { Button } from '../UI/Button';

interface ChatSidebarProps {
  section: Section;
  projectId: string;
  framework: Framework;
  onClose: () => void;
}

function BookFootnotes({ refs }: { refs: BookReference[] }) {
  const valid = refs.filter(r => r.concept_name || r.book_title || r.chapter || r.page);
  if (valid.length === 0) return null;
  return (
    <div className="mt-2 pt-2 border-t border-border/40">
      <ol className="space-y-0.5 list-none p-0 m-0">
        {valid.map((ref, i) => {
          const location = [ref.chapter, ref.page ? `p.\u2009${ref.page}` : ''].filter(Boolean).join(', ');
          return (
            <li key={i} className="flex gap-1.5 text-[11px] text-muted-foreground leading-snug">
              <span className="flex-shrink-0 font-medium opacity-50">[{i + 1}]</span>
              <span>
                {ref.concept_name && <span className="italic text-foreground/55">&ldquo;{ref.concept_name}&rdquo;</span>}
                {(ref.book_title || location) && (
                  <span className="opacity-60">
                    {ref.concept_name ? ' — ' : ''}
                    {ref.book_title && <span>{ref.book_title}</span>}
                    {location && <span>{ref.book_title ? ', ' : ''}{location}</span>}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isReview = message.message_type === 'review';
  const consultedAgents: ConsultedAgent[] = message.consulted_agents || [];

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 animate-fade-up`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 ${
          isUser
            ? 'bg-amber-500/15 text-amber-100 border border-amber-500/10'
            : isReview
            ? 'bg-card border border-border'
            : 'bg-muted/50 border border-border'
        }`}
      >
        {consultedAgents.length > 0 && (
          <div className="flex items-center flex-wrap gap-1.5 mb-2 pb-2 border-b border-border/60">
            <span className="text-xs text-muted-foreground">Consulted:</span>
            {consultedAgents.map((ca) => (
              <span
                key={ca.agent_id}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                style={{ borderColor: ca.color + '40', color: ca.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ca.color }} />
                {ca.name}
              </span>
            ))}
          </div>
        )}
        {isReview && (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Structured Review</span>
          </div>
        )}
        <MarkdownContent content={message.content} className="text-sm leading-relaxed" />
        {message.book_references && message.book_references.length > 0 && (
          <BookFootnotes refs={message.book_references} />
        )}
      </div>
    </div>
  );
}

export function ChatSidebar({ section, projectId, framework: _framework, onClose }: ChatSidebarProps) {
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch agents
  const { data: agents = [] } = useQuery({
    queryKey: [QUERY_KEYS.AGENTS],
    queryFn: () => api.getAgents(),
  });

  // Auto-select first agent
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  // Create/get session when agent is selected
  useEffect(() => {
    if (!selectedAgentId || !projectId) return;

    const getOrCreateSession = async () => {
      try {
        const session = await api.createChatSession({
          agent_id: selectedAgentId,
          project_id: projectId,
        });
        setSessionId(session.id);
      } catch (err) {
        console.error('Failed to create session:', err);
      }
    };
    getOrCreateSession();
  }, [selectedAgentId, projectId]);

  // Fetch messages
  const { data: messages = [] } = useQuery({
    queryKey: QUERY_KEYS.CHAT_MESSAGES(sessionId || ''),
    queryFn: () => api.getChatMessages(sessionId!),
    enabled: !!sessionId,
    refetchInterval: false,
  });

  // Scroll to bottom on new messages or streaming updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const selectedAgent = agents.find((a: Agent) => a.id === selectedAgentId);

  // Trigger review mutation
  const reviewMutation = useMutation({
    mutationFn: () => api.triggerChatReview(sessionId!, section.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CHAT_MESSAGES(sessionId!) });
    },
  });

  const handleSend = async () => {
    if (!inputValue.trim() || !sessionId || isStreaming) return;
    const content = inputValue.trim();
    setInputValue('');
    setIsStreaming(true);
    setStreamingText('');

    // Optimistically add user message
    const optimisticMsg: ChatMessage = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content,
      message_type: 'chat',
      book_references: [],
      consulted_agents: [],
      created_at: new Date().toISOString(),
    };
    queryClient.setQueryData(
      QUERY_KEYS.CHAT_MESSAGES(sessionId),
      (old: ChatMessage[] | undefined) => [...(old || []), optimisticMsg]
    );

    try {
      await api.sendChatMessageStream(
        sessionId,
        content,
        (chunk) => setStreamingText((prev) => prev + chunk),
        () => {},
      );
    } catch (err) {
      console.error('Chat stream error:', err);
    } finally {
      setStreamingText('');
      setIsStreaming(false);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CHAT_MESSAGES(sessionId) });
    }
  };

  const handleReview = () => {
    if (!sessionId || isStreaming) return;
    reviewMutation.mutate();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleAgentSwitch = (agentId: string) => {
    setSelectedAgentId(agentId);
    setSessionId(null);
    setShowAgentDropdown(false);
  };

  return (
    <ResizablePanel
      defaultWidth={400}
      minWidth={280}
      maxWidth={600}
      storageKey={STORAGE_KEYS.CHAT_SIDEBAR_WIDTH}
    >
    <div className="border-l border-border bg-card/30 backdrop-blur-sm flex flex-col h-full animate-slide-in-right">
      {/* Header with agent selector */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="relative flex-1">
          <button
            onClick={() => setShowAgentDropdown(!showAgentDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/50 transition-colors text-sm font-medium text-foreground"
          >
            {selectedAgent && (
              <span
                className="w-2.5 h-2.5 rounded-full ring-2 ring-background"
                style={{ backgroundColor: selectedAgent.color }}
              />
            )}
            <span>{selectedAgent?.name || 'Select Agent'}</span>
            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${showAgentDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showAgentDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-card border border-border rounded-xl shadow-xl z-10 animate-fade-in overflow-hidden">
              {agents.map((agent: Agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleAgentSwitch(agent.id)}
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2.5 ${
                    agent.id === selectedAgentId ? 'bg-amber-500/10 text-amber-300' : 'text-foreground'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: agent.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{agent.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {agent.agent_type === 'orchestrator' && (
                        <span className="text-violet-400">Orchestrator</span>
                      )}
                      {agent.agent_type === 'tag_based' && (
                        <span className="text-emerald-400">
                          Tags: {(agent.tags_filter || []).slice(0, 2).join(', ') || 'none'}
                        </span>
                      )}
                      {agent.agent_type === 'book_based' && agent.book_count > 0 && (
                        <span>{agent.book_count} book{agent.book_count !== 1 ? 's' : ''} linked</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {agents.length === 0 && (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                  No agents found. Seed defaults first.
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center py-10 animate-fade-up">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
              <Lightbulb className="h-5 w-5 text-amber-400" />
            </div>
            <p className="text-sm font-medium text-foreground/80 mb-1">
              {selectedAgent
                ? `Chat with ${selectedAgent.name}`
                : 'Select an agent to start'}
            </p>
            <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
              Get a structured review or ask questions about your screenplay
            </p>
            {selectedAgent && section.user_notes && (
              <Button onClick={handleReview} size="sm" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Review this section
              </Button>
            )}
          </div>
        )}

        {messages.map((msg: ChatMessage) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {streamingText && (
          <div className="flex justify-start mb-4 animate-fade-in">
            <div className="max-w-[85%] rounded-xl px-4 py-3 bg-muted/50 border border-border">
              <MarkdownContent content={streamingText} className="text-sm leading-relaxed" />
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex justify-start mb-4 animate-fade-in">
            <div className="bg-muted/50 border border-border rounded-xl px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-amber-500/60" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Review button (shown when there are messages) */}
      {messages.length > 0 && section.user_notes && !isStreaming && (
        <div className="px-4 pb-2">
          <button
            onClick={handleReview}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/15 transition-colors"
          >
            <Sparkles className="h-3 w-3" />
            Review current section
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your screenplay..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30 transition-all"
            disabled={!sessionId || isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || !sessionId || isStreaming}
            className="p-2 bg-amber-500/15 text-amber-400 border border-amber-500/20 rounded-lg hover:bg-amber-500/25 transition-colors disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
    </ResizablePanel>
  );
}
