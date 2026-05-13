import { useNavigate } from 'react-router-dom';
import { Film } from 'lucide-react';
import { ROUTES } from '../../lib/constants';
import type { SceneLink } from '../../types';

interface ElementSceneListProps {
  sceneLinks: SceneLink[];
  projectId: string;
}

export function ElementSceneList({ sceneLinks, projectId }: ElementSceneListProps) {
  const navigate = useNavigate();

  if (sceneLinks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground/60">No scene appearances</p>
    );
  }

  return (
    <div className="space-y-2">
      {sceneLinks.map((link) => (
        <div
          key={link.id}
          onClick={() => navigate(ROUTES.PROJECT_WORKSPACE(projectId, 'scenes', 'scene_list', link.scene_item_id))}
          className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors border border-border/30"
        >
          <Film className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground truncate block">
              {link.scene_title || 'Untitled Scene'}
            </span>
            {link.context && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {link.context}
              </span>
            )}
          </div>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
              link.source === 'ai'
                ? 'bg-blue-500/10 text-blue-400'
                : 'bg-emerald-500/10 text-emerald-400'
            }`}
          >
            {link.source === 'ai' ? 'AI' : 'User'}
          </span>
        </div>
      ))}
    </div>
  );
}
