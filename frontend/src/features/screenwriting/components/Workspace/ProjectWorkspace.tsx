import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { STORAGE_KEYS } from '../../lib/constants';
import { PhaseNavigation } from './PhaseNavigation';
import type { YoloProgress } from './PhaseNavigation';
import { SubsectionSidebar } from './SubsectionSidebar';
import { ContentArea } from './ContentArea';
import { SidebarChat } from '../Shared/SidebarChat';
import { SnapshotPanel } from '../Snapshots/SnapshotPanel';
import type { PhaseConfig, SubsectionConfig, YoloEvent } from '../../types/template';

export function ProjectWorkspace() {
  const { projectId, phase, subsectionKey, itemId } = useParams<{
    projectId: string;
    phase?: string;
    subsectionKey?: string;
    itemId?: string;
  }>();
  const navigate = useNavigate();

  const queryClient = useQueryClient();
  const [selectedPhase, setSelectedPhase] = useState<string>(() => {
    if (phase) return phase;
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_PHASE) || '{}');
      return stored[projectId!] || 'idea';
    } catch { return 'idea'; }
  });
  const [selectedSubsection, setSelectedSubsection] = useState<string>(() => {
    if (subsectionKey) return subsectionKey;
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_SUBSECTION) || '{}');
      return stored[projectId!] || '';
    } catch { return ''; }
  });
  const [isYoloRunning, setIsYoloRunning] = useState(false);
  const [yoloProgress, setYoloProgress] = useState<YoloProgress | null>(null);
  const [snapshotPanelOpen, setSnapshotPanelOpen] = useState(false);

  const { data: project, isLoading: projectLoading } = useQuery<any>({
    queryKey: ['project-v2', projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  const { data: templateConfig, isLoading: templateLoading } = useQuery({
    queryKey: ['template', project?.template],
    queryFn: () => api.getTemplate(project!.template!),
    enabled: !!project?.template,
  });

  const currentPhase: PhaseConfig | undefined = templateConfig?.phases?.find(
    (p: PhaseConfig) => p.id === selectedPhase
  );

  const currentSubsection: SubsectionConfig | undefined = currentPhase?.subsections?.find(
    (s: SubsectionConfig) => s.key === selectedSubsection
  );

  useEffect(() => {
    if (currentPhase && currentPhase.subsections.length > 0 && !selectedSubsection) {
      const firstKey = currentPhase.subsections[0].key;
      setSelectedSubsection(firstKey);
      try {
        const subs = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_SUBSECTION) || '{}');
        subs[projectId!] = firstKey;
        localStorage.setItem(STORAGE_KEYS.LAST_SUBSECTION, JSON.stringify(subs));
      } catch { /* localStorage unavailable */ }
    }
  }, [currentPhase, selectedSubsection, projectId]);

  useEffect(() => {
    if (phase && phase !== selectedPhase) setSelectedPhase(phase);
    if (subsectionKey && subsectionKey !== selectedSubsection) setSelectedSubsection(subsectionKey);
  }, [phase, subsectionKey]);

  const handlePhaseChange = (phaseId: string) => {
    setSelectedPhase(phaseId);
    setSelectedSubsection('');
    navigate(`/projects/${projectId}/${phaseId}`);
    try {
      const phases = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_PHASE) || '{}');
      phases[projectId!] = phaseId;
      localStorage.setItem(STORAGE_KEYS.LAST_PHASE, JSON.stringify(phases));
    } catch { /* localStorage unavailable */ }
  };

  const handleSubsectionChange = (key: string) => {
    setSelectedSubsection(key);
    navigate(`/projects/${projectId}/${selectedPhase}/${key}`);
    try {
      const subs = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_SUBSECTION) || '{}');
      subs[projectId!] = key;
      localStorage.setItem(STORAGE_KEYS.LAST_SUBSECTION, JSON.stringify(subs));
    } catch { /* localStorage unavailable */ }
  };

  const handleYoloFill = useCallback(async () => {
    if (!projectId || isYoloRunning) return;
    setIsYoloRunning(true);
    setYoloProgress(null);

    try {
      await api.yoloFill(projectId, (event: YoloEvent) => {
        if (event.type === 'start') {
          setYoloProgress({ total: event.total || 0, completed: 0, currentName: 'Starting...' });
        } else if (event.type === 'progress') {
          if (event.status === 'running') {
            setYoloProgress(prev => prev ? { ...prev, currentName: event.name || event.key || '' } : null);
          } else if (event.status === 'done' || event.status === 'skipped' || event.status === 'error') {
            setYoloProgress(prev => prev ? { ...prev, completed: (event.index ?? prev.completed) + 1 } : null);
            if (event.status === 'done') {
              queryClient.invalidateQueries({ queryKey: ['subsection-data'] });
              queryClient.invalidateQueries({ queryKey: ['list-items'] });
              queryClient.invalidateQueries({ queryKey: ['phase-data'] });
            }
          }
        } else if (event.type === 'done') {
          setYoloProgress(null);
        }
      });

      // Invalidate all data queries for this phase so UI refreshes
      queryClient.invalidateQueries({ queryKey: ['subsection-data'] });
      queryClient.invalidateQueries({ queryKey: ['list-items'] });
      queryClient.invalidateQueries({ queryKey: ['phase-data'] });
    } catch (err) {
      console.error('YOLO fill failed:', err);
    } finally {
      setIsYoloRunning(false);
      setYoloProgress(null);
    }
  }, [projectId, isYoloRunning, queryClient]);

  if (projectLoading || templateLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="flex flex-col items-center gap-3 animate-fade-up">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500/60" />
          <span className="text-sm text-muted-foreground">Loading workspace...</span>
        </div>
      </div>
    );
  }

  if (!project || !templateConfig) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="text-center animate-fade-in">
          <p className="text-foreground font-medium mb-1">Project not found</p>
          <p className="text-sm text-muted-foreground">This project may have been deleted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Phase Navigation */}
      <PhaseNavigation
        phases={templateConfig.phases}
        currentPhase={selectedPhase}
        onPhaseChange={handlePhaseChange}
        projectTitle={project.title}
        projectId={projectId}
        onYoloFill={handleYoloFill}
        isYoloRunning={isYoloRunning}
        yoloProgress={yoloProgress}
        onToggleSnapshots={() => setSnapshotPanelOpen(prev => !prev)}
        isSnapshotPanelOpen={snapshotPanelOpen}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Subsection Sidebar */}
        {currentPhase && (
          <SubsectionSidebar
            subsections={currentPhase.subsections}
            currentSubsection={selectedSubsection}
            onSubsectionChange={handleSubsectionChange}
          />
        )}

        {/* Main Content Area */}
        <div className="flex-1 overflow-auto bg-background">
          {currentSubsection && projectId ? (
            <ContentArea
              subsection={currentSubsection}
              projectId={projectId}
              phase={selectedPhase}
              templateConfig={templateConfig}
              itemId={itemId}
              onNavigateTo={handleSubsectionChange}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground text-sm">Select a section to get started</p>
            </div>
          )}
        </div>

        {/* Chat Sidebar — always visible */}
        {projectId && selectedSubsection && (
          <SidebarChat
            projectId={projectId}
            phase={selectedPhase}
            subsectionKey={selectedSubsection}
            contextItemId={itemId}
            subsection={currentSubsection}
          />
        )}

        {/* Snapshot History Panel */}
        {projectId && snapshotPanelOpen && (
          <SnapshotPanel
            projectId={projectId}
            isOpen={snapshotPanelOpen}
            onClose={() => setSnapshotPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
