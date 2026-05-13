import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Bot, Tag, BookOpen, Network, X, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, ORCHESTRATOR_PROMPT_TEMPLATE } from '../../lib/constants';
import { type Agent, type AgentType } from '../../types';
import { Button } from '../UI/Button';
import { AgentPipelineTree } from './AgentPipelineTree';

const AGENT_TYPE_CONFIG: Record<AgentType, { label: string; color: string; icon: typeof Bot }> = {
  book_based: { label: 'Book Agent', color: 'text-amber-400', icon: BookOpen },
  tag_based: { label: 'Tag Agent', color: 'text-emerald-400', icon: Tag },
  orchestrator: { label: 'Orchestrator', color: 'text-violet-400', icon: Network },
};

const AGENT_COLORS = [
  '#6366f1', '#f59e0b', '#06b6d4', '#10b981', '#f43f5e',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#a855f7',
];

function AgentTypeBadge({ type }: { type: AgentType }) {
  const config = AGENT_TYPE_CONFIG[type] || AGENT_TYPE_CONFIG.book_based;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${config.color}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

interface CreateAgentFormProps {
  availableTags: string[];
  onClose: () => void;
  onCreate: (data: {
    name: string;
    description?: string;
    system_prompt_template: string;
    personality?: string;
    color: string;
    icon: string;
    agent_type: AgentType;
    tags_filter: string[];
  }) => void;
  isLoading: boolean;
}

function CreateAgentForm({ availableTags, onClose, onCreate, isLoading }: CreateAgentFormProps) {
  const [agentType, setAgentType] = useState<AgentType>('book_based');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [personality, setPersonality] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState(AGENT_COLORS[0]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleTypeChange = (type: AgentType) => {
    setAgentType(type);
    if (type === 'orchestrator' && !systemPrompt) {
      setSystemPrompt(ORCHESTRATOR_PROMPT_TEMPLATE.replace('{name}', name || 'Orchestrator'));
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    const template =
      systemPrompt.trim() ||
      `You are ${name}, a knowledgeable screenwriting consultant. Help writers improve their screenplays using the knowledge below.\n\n## Relevant Concepts\n{concept_cards}\n\n## Book Excerpts\n{book_chunks}\n\n## Writer's Project\n{project_context}`;

    onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      system_prompt_template: template,
      personality: personality.trim() || undefined,
      color: selectedColor,
      icon: agentType === 'orchestrator' ? 'network' : agentType === 'tag_based' ? 'tag' : 'book',
      agent_type: agentType,
      tags_filter: agentType === 'tag_based' ? selectedTags : [],
    });
  };

  return (
    <div className="border border-border rounded-xl bg-card/50 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">New Agent</h3>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Agent type selector */}
      <div className="flex gap-2 mb-4">
        {(['book_based', 'tag_based', 'orchestrator'] as AgentType[]).map((type) => (
          <button
            key={type}
            onClick={() => handleTypeChange(type)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
              agentType === type
                ? type === 'orchestrator'
                  ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                  : type === 'tag_based'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : 'text-muted-foreground border-border hover:border-muted-foreground/30'
            }`}
          >
            {AGENT_TYPE_CONFIG[type].label}
          </button>
        ))}
      </div>

      {/* Type descriptions */}
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        {agentType === 'book_based' && 'Draws knowledge from specific books you link to it.'}
        {agentType === 'tag_based' && 'Aggregates concepts matching selected tags from all your books.'}
        {agentType === 'orchestrator' && 'Routes queries to relevant specialists and synthesizes their insights.'}
      </p>

      {/* Name */}
      <div className="mb-3">
        <label className="text-xs font-medium text-muted-foreground block mb-1">Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Character Agent"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30"
        />
      </div>

      {/* Description */}
      <div className="mb-3">
        <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this agent specialize in?"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30"
        />
      </div>

      {/* Tag picker — only for TAG_BASED */}
      {agentType === 'tag_based' && (
        <div className="mb-3">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Tags to specialize in
          </label>
          {availableTags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 p-3 border border-border rounded-lg bg-muted/20 max-h-32 overflow-y-auto">
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    selectedTags.includes(tag)
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'text-muted-foreground border-border hover:border-muted-foreground/30 hover:text-foreground'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground p-3 border border-border rounded-lg bg-muted/20">
              No tags available yet — upload and process a book first.
            </p>
          )}
          {selectedTags.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {selectedTags.length} tag{selectedTags.length !== 1 ? 's' : ''} selected
            </p>
          )}
        </div>
      )}

      {/* Color picker */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">Color</label>
        <div className="flex gap-1.5 flex-wrap">
          {AGENT_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => setSelectedColor(color)}
              className={`w-6 h-6 rounded-full border-2 transition-all ${
                selectedColor === color ? 'border-white scale-110' : 'border-transparent'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {/* Advanced: personality + system prompt */}
      <div className="mb-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Advanced settings
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Personality / Communication style</label>
              <textarea
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                placeholder="e.g. Direct and analytical, like a seasoned script editor"
                rows={2}
                className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">System prompt template</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Customize how this agent responds..."
                rows={5}
                className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500/30"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handleSubmit}
          disabled={!name.trim() || isLoading || (agentType === 'tag_based' && selectedTags.length === 0)}
          size="sm"
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Create agent
        </Button>
        <Button onClick={onClose} variant="ghost" size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function AgentManager() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: agents = [] } = useQuery({
    queryKey: [QUERY_KEYS.AGENTS],
    queryFn: () => api.getAgents(),
  });

  const { data: tagsData } = useQuery({
    queryKey: [QUERY_KEYS.AGENT_TAGS],
    queryFn: () => api.getAgentTags(),
  });
  const availableTags = tagsData?.tags || [];

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createAgent>[0]) => api.createAgent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.AGENTS] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PIPELINE_MAP] });
      setShowCreateForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (agentId: string) => api.deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.AGENTS] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PIPELINE_MAP] });
    },
  });

  const userAgents = agents.filter((a: Agent) => !a.is_default);
  const defaultAgents = agents.filter((a: Agent) => a.is_default);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Agents</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Create book agents, tag agents, or an orchestrator
          </p>
        </div>
        {!showCreateForm && (
          <Button onClick={() => setShowCreateForm(true)} size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New agent
          </Button>
        )}
      </div>

      {showCreateForm && (
        <CreateAgentForm
          availableTags={availableTags}
          onClose={() => setShowCreateForm(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isLoading={createMutation.isPending}
        />
      )}

      {/* User-created agents */}
      {userAgents.length > 0 && (
        <div className="space-y-2 mb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your agents</p>
          {userAgents.map((agent: Agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              onDelete={() => deleteMutation.mutate(agent.id)}
              isDeleting={deleteMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Default/seeded agents */}
      {defaultAgents.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Default agents</p>
          {defaultAgents.map((agent: Agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {agents.length === 0 && !showCreateForm && (
        <div className="text-center py-8 text-muted-foreground">
          <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No agents yet.</p>
          <p className="text-xs mt-1">Create your first agent or seed the defaults above.</p>
        </div>
      )}

      {/* Pipeline Map Tree */}
      <div className="mt-6 pt-6 border-t border-border">
        <AgentPipelineTree />
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  onDelete,
  isDeleting,
}: {
  agent: Agent;
  onDelete?: () => void;
  isDeleting?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors">
      <span
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: agent.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
          <AgentTypeBadge type={agent.agent_type || 'book_based'} />
        </div>
        {agent.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{agent.description}</p>
        )}
        {agent.agent_type === 'tag_based' && agent.tags_filter.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {agent.tags_filter.slice(0, 4).map((tag) => (
              <span key={tag} className="text-xs px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">
                {tag}
              </span>
            ))}
            {agent.tags_filter.length > 4 && (
              <span className="text-xs text-muted-foreground">+{agent.tags_filter.length - 4} more</span>
            )}
          </div>
        )}
        {agent.agent_type === 'book_based' && agent.book_count > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {agent.book_count} book{agent.book_count !== 1 ? 's' : ''} linked
          </p>
        )}
      </div>
      {onDelete && !agent.is_default && (
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="p-1.5 text-muted-foreground hover:text-destructive rounded transition-colors disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
