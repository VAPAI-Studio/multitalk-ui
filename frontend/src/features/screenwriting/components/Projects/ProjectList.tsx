import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Loader2, Tv, Film } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS, ROUTES, ERROR_MESSAGES } from '../../lib/constants';
import { Button } from '../UI/Button';
import { ProjectCard } from './ProjectCard';
import { CreateProjectModal } from './CreateProjectModal';
import { ShowCard } from '../Shows/ShowCard';
import { CreateShowModal } from '../Shows/CreateShowModal';
import type { Show } from '../../types';

export function ProjectList() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreateShowModalOpen, setIsCreateShowModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: projects, isLoading: projectsLoading, isError, error } = useQuery({
    queryKey: [QUERY_KEYS.PROJECTS],
    queryFn: api.getProjects,
  });

  const { data: shows, isLoading: showsLoading } = useQuery({
    queryKey: [QUERY_KEYS.SHOWS],
    queryFn: api.getShows,
  });

  const isLoading = projectsLoading || showsLoading;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PROJECTS] });
    },
  });

  const deleteShowMutation = useMutation({
    mutationFn: (id: string) => api.deleteShow(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SHOWS] });
    },
  });

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this project? This cannot be undone.')) {
      deleteMutation.mutate(id);
    }
  };

  const handleDeleteShow = (id: string) => {
    if (window.confirm('Delete this show? This will remove all episodes. This cannot be undone.')) {
      deleteShowMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-3 animate-fade-up">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500/60" />
          <span className="text-sm text-muted-foreground">Loading projects...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center animate-fade-in">
        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <span className="text-destructive text-lg">!</span>
        </div>
        <p className="text-foreground font-medium mb-1">{ERROR_MESSAGES.GENERIC}</p>
        <p className="text-sm text-muted-foreground mb-5 max-w-sm">
          {error instanceof Error ? error.message : ERROR_MESSAGES.NETWORK}
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-10 animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between mb-10">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-foreground">
            Home
          </h1>
          <p className="mt-2 text-muted-foreground">
            Your film automation workspace
          </p>
        </div>
      </div>

      {/* Shows */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Tv className="h-5 w-5 text-indigo-400" />
            <h2 className="text-xl font-semibold text-foreground">Shows</h2>
          </div>
          <Button variant="outline" size="sm" onClick={() => setIsCreateShowModalOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Show
          </Button>
        </div>
        {shows?.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-border rounded-xl">
            <Tv className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No shows yet</p>
            <Button variant="ghost" size="sm" onClick={() => setIsCreateShowModalOpen(true)} className="mt-2 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Create your first show
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {shows?.map((show: Show, index: number) => (
              <Link
                key={show.id}
                to={ROUTES.SHOW(show.id)}
                className="animate-fade-up"
                style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'both' }}
              >
                <ShowCard show={show} onDelete={handleDeleteShow} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Films */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-amber-400" />
            <h2 className="text-xl font-semibold text-foreground">Films</h2>
          </div>
          <Button variant="outline" size="sm" onClick={() => setIsCreateModalOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Project
          </Button>
        </div>
        {projects?.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-border rounded-xl">
            <Film className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No film projects yet</p>
            <Button variant="ghost" size="sm" onClick={() => setIsCreateModalOpen(true)} className="mt-2 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Create your first project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects?.map((project: any, index: number) => {
              const isTemplate = !!(project as any).template;
              const href = isTemplate
                ? `/projects/${project.id}/${(project as any).current_phase || 'idea'}`
                : `/projects/${project.id}`;
              return (
                <Link
                  key={project.id}
                  to={href}
                  className="animate-fade-up"
                  style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'both' }}
                >
                  <ProjectCard project={project} onDelete={handleDelete} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <CreateProjectModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
      />
      <CreateShowModal
        open={isCreateShowModalOpen}
        onOpenChange={setIsCreateShowModalOpen}
      />
    </div>
  );
}
