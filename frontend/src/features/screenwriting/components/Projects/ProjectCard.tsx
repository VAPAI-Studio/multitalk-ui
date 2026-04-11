import { Clock, Trash2 } from 'lucide-react';
import { type Project } from '../../types';
import { FRAMEWORK_LABELS } from '../../lib/section-config';

const TEMPLATE_NAMES: Record<string, string> = {
  short_movie: 'Short Movie',
};

const TEMPLATE_COLORS: Record<string, string> = {
  short_movie: 'from-amber-500/20 to-orange-500/20 border-amber-500/20',
};

const PHASE_COLORS: Record<string, string> = {
  idea: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  story: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  scenes: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  write: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
};

interface ProjectCardProps {
  project: Project & { template?: string; current_phase?: string };
  onDelete?: (id: string) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const isTemplateProject = !!project.template;
  const templateColor = project.template ? TEMPLATE_COLORS[project.template] : '';
  const phaseColor = project.current_phase ? PHASE_COLORS[project.current_phase] : '';

  return (
    <div className="group relative bg-card border border-border rounded-xl p-5 transition-all duration-300 hover:border-amber-500/20 hover:glow-amber">
      {/* Warm accent gradient at top */}
      {isTemplateProject && (
        <div className={`absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-gradient-to-r ${templateColor}`} />
      )}

      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-foreground truncate group-hover:text-amber-100 transition-colors">
            {project.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {isTemplateProject
              ? TEMPLATE_NAMES[project.template!] || project.template
              : FRAMEWORK_LABELS[project.framework]
            }
          </p>
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(project.id);
            }}
            className="p-1.5 text-transparent group-hover:text-muted-foreground hover:!text-destructive rounded-lg transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatDate(project.created_at)}
        </div>

        <div className="flex gap-1.5">
          {isTemplateProject && project.current_phase && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${phaseColor}`}>
              {project.current_phase}
            </span>
          )}
          {!isTemplateProject && project.sections?.filter(s => s.user_notes).length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {project.sections.filter(s => s.user_notes).length} filled
            </span>
          )}
          {!isTemplateProject && project.sections?.some(s => s.ai_suggestions?.issues?.length > 0) && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
              AI notes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
