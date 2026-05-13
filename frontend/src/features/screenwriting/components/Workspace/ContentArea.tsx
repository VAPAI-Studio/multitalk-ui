import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import type { SubsectionConfig, TemplateConfig } from '../../types/template';

import { StructuredFormView } from '../Patterns/StructuredFormView';
import { CardGridView } from '../Patterns/CardGridView';
import { RepeatableCardsView } from '../Patterns/RepeatableCardsView';
import { WizardView } from '../Patterns/WizardView';
import { OrderedListView } from '../Patterns/OrderedListView';
import { IndividualEditorView } from '../Patterns/IndividualEditorView';
import { ScreenplayEditorView } from '../Patterns/ScreenplayEditorView';
import { PlaceholderView } from '../Patterns/PlaceholderView';

interface ContentAreaProps {
  subsection: SubsectionConfig;
  projectId: string;
  phase: string;
  templateConfig: TemplateConfig;
  itemId?: string;
  onNavigateTo?: (key: string) => void;
}

export function ContentArea({ subsection, projectId, phase, templateConfig, itemId, onNavigateTo }: ContentAreaProps) {
  const { data: phaseData, isLoading } = useQuery({
    queryKey: QUERY_KEYS.SUBSECTION_DATA(projectId, phase, subsection.key),
    queryFn: () => api.getSubsectionData(projectId, phase, subsection.key),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const commonProps = {
    subsection,
    projectId,
    phase,
    phaseData: phaseData || null,
    templateConfig,
  };

  switch (subsection.ui_pattern) {
    case 'structured_form':
      return <StructuredFormView {...commonProps} />;

    case 'card_grid':
      return <CardGridView {...commonProps} />;

    case 'repeatable_cards':
      return <RepeatableCardsView {...commonProps} />;

    case 'wizard':
      return <WizardView {...commonProps} onApplySuccess={onNavigateTo} />;

    case 'wizard_with_chat':
      return <WizardView {...commonProps} withChat onApplySuccess={onNavigateTo} />;

    case 'import_wizard':
      return <WizardView {...commonProps} isImport />;

    case 'ordered_list':
      return <OrderedListView {...commonProps} />;

    case 'individual_editor':
      return <IndividualEditorView {...commonProps} itemId={itemId} />;

    case 'screenplay_editor':
      return <ScreenplayEditorView {...commonProps} />;

    case 'analyzer':
      return (
        <PlaceholderView
          title={subsection.name}
          description={subsection.description || ''}
          pattern={subsection.ui_pattern}
        />
      );

    default:
      return (
        <PlaceholderView
          title={subsection.name}
          description={subsection.description || ''}
          pattern={subsection.ui_pattern}
        />
      );
  }
}
