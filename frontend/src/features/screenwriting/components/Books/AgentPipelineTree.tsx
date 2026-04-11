import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Network, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { type Agent, type AgentType, type PipelineMapEntry } from '../../types';
import type { TemplateConfig } from '../../types/template';

// ============================================================
// Internal tree types (not exported)
// ============================================================

interface TreePhase {
  phase: string;
  phaseName: string;
  subsections: TreeSubsection[];
}

interface TreeSubsection {
  key: string;
  name: string;
  agents: TreeAgent[];
}

interface TreeAgent {
  agentId: string;
  name: string;
  color: string;
  icon: string;
  agentType: AgentType;
  confidence: number;
  isActive: boolean;
}

// ============================================================
// Pure function: group flat entries into tree hierarchy
// ============================================================

function buildTreeData(
  entries: PipelineMapEntry[],
  agents: Agent[],
  templateConfig: TemplateConfig,
): TreePhase[] {
  const agentMap = new Map(agents.map(a => [a.id, a]));
  const grouped = new Map<string, Map<string, PipelineMapEntry[]>>();

  for (const entry of entries) {
    if (!grouped.has(entry.phase)) grouped.set(entry.phase, new Map());
    const phaseMap = grouped.get(entry.phase)!;
    if (!phaseMap.has(entry.subsection_key)) phaseMap.set(entry.subsection_key, []);
    phaseMap.get(entry.subsection_key)!.push(entry);
  }

  return templateConfig.phases
    .filter(p => grouped.has(p.id))
    .map(phase => ({
      phase: phase.id,
      phaseName: phase.name,
      subsections: phase.subsections
        .filter(s => grouped.get(phase.id)?.has(s.key))
        .map(sub => ({
          key: sub.key,
          name: sub.name,
          agents: (grouped.get(phase.id)?.get(sub.key) || [])
            .map(entry => {
              const agent = agentMap.get(entry.agent_id);
              return agent ? {
                agentId: entry.agent_id,
                name: agent.name,
                color: agent.color,
                icon: agent.icon,
                agentType: agent.agent_type,
                confidence: entry.confidence,
                isActive: agent.is_active,
              } : null;
            })
            .filter(Boolean) as TreeAgent[],
        })),
    }));
}

// ============================================================
// AgentToggleBadge sub-component
// ============================================================

function AgentToggleBadge({ agent, onToggle, isToggling }: {
  agent: TreeAgent;
  onToggle: (agentId: string, newState: boolean) => void;
  isToggling: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
      agent.isActive
        ? 'border-border bg-muted/20'
        : 'border-border/50 bg-muted/5 opacity-50'
    }`}>
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: agent.color }}
      />
      <span className="text-xs font-medium text-foreground truncate max-w-[80px]">{agent.name}</span>
      <span className="text-xs text-muted-foreground">{Math.round(agent.confidence * 100)}%</span>
      <button
        onClick={() => onToggle(agent.agentId, !agent.isActive)}
        disabled={isToggling}
        className={`ml-auto w-7 h-4 rounded-full transition-colors flex-shrink-0 relative ${
          agent.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/30'
        }`}
      >
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
          agent.isActive ? 'left-3.5' : 'left-0.5'
        }`} />
      </button>
    </div>
  );
}

// ============================================================
// Main component
// ============================================================

export function AgentPipelineTree() {
  const queryClient = useQueryClient();

  // Data fetching (3 queries)
  const pipelineQuery = useQuery({
    queryKey: [QUERY_KEYS.PIPELINE_MAP],
    queryFn: () => api.getPipelineMap(),
  });

  const agentsQuery = useQuery({
    queryKey: [QUERY_KEYS.AGENTS],
    queryFn: () => api.getAgents(),
  });

  const templateQuery = useQuery({
    queryKey: QUERY_KEYS.TEMPLATE('short_movie'),
    queryFn: () => api.getTemplate('short_movie'),
  });

  // Collapsible state -- all collapsed by default
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  // Toggle mutation
  const toggleMutation = useMutation({
    mutationFn: ({ agentId, isActive }: { agentId: string; isActive: boolean }) =>
      api.updateAgent(agentId, { is_active: isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.AGENTS] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PIPELINE_MAP] });
    },
  });

  const isLoading = pipelineQuery.isLoading || agentsQuery.isLoading || templateQuery.isLoading;

  const treeData = useMemo(() => {
    if (!pipelineQuery.data || !agentsQuery.data || !templateQuery.data) return [];
    return buildTreeData(pipelineQuery.data.entries, agentsQuery.data, templateQuery.data);
  }, [pipelineQuery.data, agentsQuery.data, templateQuery.data]);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Network className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Pipeline Map</h3>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          <div className="animate-pulse bg-muted/40 rounded h-6 w-3/4" />
          <div className="animate-pulse bg-muted/40 rounded h-6 w-1/2" />
          <div className="animate-pulse bg-muted/40 rounded h-6 w-2/3" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && treeData.length === 0 && (
        <div className="text-center py-6 text-muted-foreground">
          <Network className="h-7 w-7 mx-auto mb-2 opacity-30" />
          <p className="text-xs">Create agents to see how they map to your pipeline</p>
        </div>
      )}

      {/* Phase tree */}
      {treeData.map(phase => (
        <div key={phase.phase}>
          {/* Phase header -- clickable to expand/collapse */}
          <button onClick={() => togglePhase(phase.phase)} className="flex items-center gap-1.5 w-full text-left py-1.5 hover:bg-muted/30 rounded px-1">
            {expandedPhases.has(phase.phase)
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="text-sm font-medium text-foreground">{phase.phaseName}</span>
            <span className="text-xs text-muted-foreground ml-auto">
              {phase.subsections.reduce((sum, s) => sum + s.agents.length, 0)} agent(s)
            </span>
          </button>

          {/* Subsections -- only render when phase is expanded */}
          {expandedPhases.has(phase.phase) && (
            <div className="ml-4 mt-1 space-y-2 mb-2">
              {phase.subsections.map(sub => (
                <div key={sub.key}>
                  <p className="text-xs font-medium text-muted-foreground mb-1">{sub.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sub.agents.map(agent => (
                      <AgentToggleBadge
                        key={agent.agentId}
                        agent={agent}
                        onToggle={(agentId, newState) =>
                          toggleMutation.mutate({ agentId, isActive: newState })}
                        isToggling={toggleMutation.isPending}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
