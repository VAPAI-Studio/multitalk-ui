import { useState } from 'react';
import { Lightbulb, BookOpen, Clapperboard, PenTool, Zap, Loader2, ListChecks, Trash2, History } from 'lucide-react';
import type { PhaseConfig } from '../../types/template';
import { RemoveScreenplayModal } from '../Snapshots/RemoveScreenplayModal';

const PHASE_ICONS: Record<string, typeof Lightbulb> = {
  idea: Lightbulb,
  story: BookOpen,
  scenes: Clapperboard,
  write: PenTool,
};

const PHASE_COLORS: Record<string, { active: string; dot: string }> = {
  idea: { active: 'text-violet-400 border-violet-400', dot: 'bg-violet-400' },
  story: { active: 'text-blue-400 border-blue-400', dot: 'bg-blue-400' },
  scenes: { active: 'text-amber-400 border-amber-400', dot: 'bg-amber-400' },
  write: { active: 'text-emerald-400 border-emerald-400', dot: 'bg-emerald-400' },
};

export interface YoloProgress {
  total: number;
  completed: number;
  currentName: string;
}

interface PhaseNavigationProps {
  phases: PhaseConfig[];
  currentPhase: string;
  onPhaseChange: (phaseId: string) => void;
  projectTitle?: string;
  projectId?: string;
  onYoloFill?: () => void;
  isYoloRunning?: boolean;
  yoloProgress?: YoloProgress | null;
  onBreakdownClick?: () => void;
  isBreakdownActive?: boolean;
  onToggleSnapshots?: () => void;
  isSnapshotPanelOpen?: boolean;
}

export function PhaseNavigation({ phases, currentPhase, onPhaseChange, projectTitle, projectId, onYoloFill, isYoloRunning, yoloProgress, onBreakdownClick, isBreakdownActive, onToggleSnapshots, isSnapshotPanelOpen }: PhaseNavigationProps) {
  const [showRemoveModal, setShowRemoveModal] = useState(false);

  return (
    <div className="border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
      <div className="flex items-center px-5 gap-6">
        {/* Project title */}
        {projectTitle && (
          <span className="text-sm font-medium text-muted-foreground truncate max-w-[180px] py-3 border-r border-border pr-6">
            {projectTitle}
          </span>
        )}

        {/* Phase tabs */}
        <nav className="flex items-center gap-0.5" aria-label="Phase Navigation">
          {phases.map((phase, index) => {
            const isActive = phase.id === currentPhase;
            const isPast = phases.findIndex(p => p.id === currentPhase) > index;
            const Icon = PHASE_ICONS[phase.id] || BookOpen;
            const colors = PHASE_COLORS[phase.id] || PHASE_COLORS.idea;

            return (
              <div key={phase.id} className="flex items-center">
                <button
                  onClick={() => onPhaseChange(phase.id)}
                  className={`
                    relative flex items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider
                    transition-all duration-200 border-b-2 -mb-px
                    ${isActive
                      ? colors.active
                      : isPast
                        ? 'border-transparent text-muted-foreground/70 hover:text-foreground/80'
                        : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground/70'
                    }
                  `}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{phase.name}</span>
                </button>

                {/* Connector line between phases */}
                {index < phases.length - 1 && (
                  <div className="flex items-center px-1">
                    <div className={`w-4 h-px ${isPast ? 'bg-muted-foreground/30' : 'bg-border'}`} />
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Breakdown tab — separated by vertical divider */}
        {onBreakdownClick && (
          <>
            <div className="w-px h-4 bg-border mx-2 flex-shrink-0" />
            <button
              onClick={onBreakdownClick}
              className={`
                flex items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider
                transition-all duration-200 border-b-2 -mb-px flex-shrink-0
                ${isBreakdownActive
                  ? 'text-amber-400 border-amber-400'
                  : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground/70'
                }
              `}
            >
              <ListChecks className="h-3.5 w-3.5" />
              <span>Breakdown</span>
            </button>
          </>
        )}

        {/* History button — toggles snapshot panel */}
        {onToggleSnapshots && (
          <>
            <div className="w-px h-4 bg-border mx-2 flex-shrink-0" />
            <button
              onClick={onToggleSnapshots}
              className={`
                flex items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider
                transition-all duration-200 border-b-2 -mb-px flex-shrink-0
                ${isSnapshotPanelOpen
                  ? 'text-amber-400 border-amber-400'
                  : 'border-transparent text-muted-foreground/40 hover:text-muted-foreground/70'
                }
              `}
            >
              <History className="h-3.5 w-3.5" />
              <span>History</span>
            </button>
          </>
        )}

        {/* Remove Screenplay button — only on write phase */}
        {currentPhase === 'write' && projectId && (
          <button
            onClick={() => setShowRemoveModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors ml-auto"
          >
            <Trash2 className="h-3 w-3" />
            <span>Remove Screenplay</span>
          </button>
        )}

        {/* YOLO button */}
        {onYoloFill && (
          <div className={currentPhase === 'write' && projectId ? '' : 'ml-auto'}>
            <button
              onClick={onYoloFill}
              disabled={isYoloRunning}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold
                transition-all duration-200
                ${isYoloRunning
                  ? 'bg-amber-500/10 text-amber-400 cursor-wait'
                  : 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-400 hover:from-amber-500/30 hover:to-orange-500/30 hover:text-amber-300 border border-amber-500/20 hover:border-amber-500/40'
                }
              `}
            >
              {isYoloRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="truncate max-w-[140px]">{yoloProgress?.currentName || 'Working...'}</span>
                  {yoloProgress && (
                    <span className="text-amber-400/60">({yoloProgress.completed}/{yoloProgress.total})</span>
                  )}
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5" />
                  <span>YOLO</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Remove Screenplay modal */}
      {projectId && (
        <RemoveScreenplayModal
          open={showRemoveModal}
          onClose={() => setShowRemoveModal(false)}
          projectId={projectId}
          onPhaseChange={onPhaseChange}
        />
      )}
    </div>
  );
}
