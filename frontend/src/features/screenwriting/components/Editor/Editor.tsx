import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { SectionEditor } from './SectionEditor';
import { ChatSidebar } from './ChatSidebar';
import { EpisodeBreadcrumb } from './EpisodeBreadcrumb';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { QUERY_KEYS, ERROR_MESSAGES } from '../../lib/constants';
import { Button } from '../UI/Button';
import { SECTION_LABELS } from '../../lib/section-config';

export function Editor() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);

  const { data: project, isLoading, isError, error } = useQuery({
    queryKey: QUERY_KEYS.PROJECT(projectId!),
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId
  });

  useKeyboardShortcuts({
    onSave: () => {},
    onReview: () => {
      if (selectedSectionId) setShowChat(true);
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="flex flex-col items-center gap-3 animate-fade-up">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500/60" />
          <span className="text-sm text-muted-foreground">Loading project...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-center animate-fade-in">
        <p className="text-foreground font-medium mb-1">{ERROR_MESSAGES.GENERIC}</p>
        <p className="text-sm text-muted-foreground mb-5">
          {error instanceof Error ? error.message : ERROR_MESSAGES.NETWORK}
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  const selectedSection = project.sections.find(s => s.id === selectedSectionId);
  const isEpisode = !!project.show_id && project.episode_number != null;

  return (
    <>
      {isEpisode && (
        <EpisodeBreadcrumb
          showId={project.show_id!}
          episodeNumber={project.episode_number!}
          episodeTitle={project.title}
        />
      )}
      <div className={`flex ${isEpisode ? 'h-[calc(100vh-89px)]' : 'h-[calc(100vh-56px)]'}`}>
      {/* Section sidebar */}
      <div className="w-56 border-r border-border bg-card/30 p-3 overflow-y-auto flex-shrink-0">
        <h2 className="text-sm font-semibold text-foreground px-3 py-2 truncate">{project.title}</h2>
        <div className="h-px bg-border my-2" />
        <nav className="space-y-0.5">
          {project.sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setSelectedSectionId(section.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                selectedSectionId === section.id
                  ? 'bg-amber-500/10 text-amber-300 font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{SECTION_LABELS[section.type]}</span>
                {section.user_notes && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                )}
              </div>
            </button>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {selectedSection ? (
          <SectionEditor
            section={selectedSection}
            framework={project.framework}
            onRequestReview={() => setShowChat(true)}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">Select a section to start editing</p>
          </div>
        )}
      </div>

      {/* Chat sidebar */}
      {showChat && selectedSection && (
        <ChatSidebar
          section={selectedSection}
          projectId={projectId!}
          framework={project.framework}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
    </>
  );
}
