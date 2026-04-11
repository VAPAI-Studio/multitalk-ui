import { Wand2, MessageSquare, Import, ClipboardList, Users, LayoutGrid, List, Edit3, Theater, Search } from 'lucide-react';
import type { SubsectionConfig } from '../../types/template';

const PATTERN_ICONS: Record<string, typeof Wand2> = {
  wizard: Wand2,
  wizard_with_chat: MessageSquare,
  import_wizard: Import,
  structured_form: ClipboardList,
  repeatable_cards: Users,
  card_grid: LayoutGrid,
  ordered_list: List,
  individual_editor: Edit3,
  screenplay_editor: Theater,
  analyzer: Search,
};

interface SubsectionSidebarProps {
  subsections: SubsectionConfig[];
  currentSubsection: string;
  onSubsectionChange: (key: string) => void;
}

export function SubsectionSidebar({ subsections, currentSubsection, onSubsectionChange }: SubsectionSidebarProps) {
  return (
    <aside className="w-52 border-r border-border bg-card/30 overflow-y-auto flex-shrink-0">
      <nav className="py-2 px-2">
        {subsections.map((sub) => {
          const isActive = sub.key === currentSubsection;
          const Icon = PATTERN_ICONS[sub.ui_pattern] || ClipboardList;

          return (
            <button
              key={sub.key}
              onClick={() => onSubsectionChange(sub.key)}
              className={`
                w-full text-left px-3 py-2 text-sm rounded-lg transition-all duration-200 flex items-center gap-2.5 mb-0.5
                ${isActive
                  ? 'bg-amber-500/10 text-amber-300 font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }
              `}
            >
              <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? 'text-amber-400' : ''}`} />
              <span className="truncate">{sub.name}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
