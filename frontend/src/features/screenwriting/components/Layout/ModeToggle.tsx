import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation, useNavigate, useMatch } from 'react-router-dom';
import { ChevronDown, PenLine, Clapperboard, Film } from 'lucide-react';
import { ROUTES } from '../../lib/constants';

export function ModeToggle() {
  const location = useLocation();
  const navigate = useNavigate();

  // useParams is unavailable in components rendered outside <Routes> (e.g. Header/Layout).
  // useMatch works anywhere inside <Router> and matches against the current URL.
  const projectMatch = useMatch('/projects/:projectId/*');
  const projectId = projectMatch?.params.projectId;

  // Only render when inside a project route
  if (!projectId) return null;

  const isBreakdown = location.pathname.endsWith('/breakdown');
  const isStoryboard = location.pathname.endsWith('/storyboard');
  const currentMode = isStoryboard ? 'storyboard' : isBreakdown ? 'breakdown' : 'screenwriting';
  const lastScreenwritingKey = `lastScreenwritingPath_${projectId}`;

  const handleSelect = (mode: 'screenwriting' | 'breakdown' | 'storyboard') => {
    if (mode === 'breakdown') {
      if (!isBreakdown) {
        localStorage.setItem(lastScreenwritingKey, location.pathname);
      }
      navigate(ROUTES.PROJECT_BREAKDOWN(projectId));
    } else if (mode === 'storyboard') {
      if (!isStoryboard) {
        localStorage.setItem(lastScreenwritingKey, location.pathname);
      }
      navigate(ROUTES.PROJECT_STORYBOARD(projectId));
    } else {
      const last = localStorage.getItem(lastScreenwritingKey);
      navigate(last ?? ROUTES.PROJECT(projectId));
    }
  };

  const modeIcon = {
    screenwriting: <PenLine className="h-3.5 w-3.5" />,
    breakdown: <Clapperboard className="h-3.5 w-3.5" />,
    storyboard: <Film className="h-3.5 w-3.5" />,
  }[currentMode];

  const modeLabel = {
    screenwriting: 'Script',
    breakdown: 'Script Breakdown',
    storyboard: 'Storyboard',
  }[currentMode];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md
            bg-muted/40 hover:bg-muted/70 text-foreground transition-colors"
        >
          {modeIcon}
          <span>{modeLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[190px] rounded-lg border border-border bg-card shadow-lg p-1"
          sideOffset={4}
        >
          <DropdownMenu.Item
            onSelect={() => handleSelect('screenwriting')}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer
              hover:bg-muted/60 text-foreground outline-none"
          >
            <PenLine className="h-3.5 w-3.5" />
            <span>Script</span>
            {currentMode === 'screenwriting' && (
              <span className="ml-auto text-xs" style={{ color: 'hsl(var(--accent))' }}>Active</span>
            )}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => handleSelect('breakdown')}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer
              hover:bg-muted/60 text-foreground outline-none"
          >
            <Clapperboard className="h-3.5 w-3.5" />
            <span>Script Breakdown</span>
            {currentMode === 'breakdown' && (
              <span className="ml-auto text-xs" style={{ color: 'hsl(var(--accent))' }}>Active</span>
            )}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => handleSelect('storyboard')}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer
              hover:bg-muted/60 text-foreground outline-none"
          >
            <Film className="h-3.5 w-3.5" />
            <span>Storyboard</span>
            {currentMode === 'storyboard' && (
              <span className="ml-auto text-xs" style={{ color: 'hsl(var(--accent))' }}>Active</span>
            )}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
