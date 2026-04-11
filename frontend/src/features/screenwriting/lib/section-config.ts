// frontend/src/lib/section-config.ts

import { SectionType, Framework } from '../types';

export const SECTION_LABELS: Record<SectionType, string> = {
  [SectionType.INCITING_INCIDENT]: "Inciting Incident",
  [SectionType.PLOT_POINT_1]: "Plot Point 1",
  [SectionType.MIDPOINT]: "Midpoint",
  [SectionType.PLOT_POINT_2]: "Plot Point 2",
  [SectionType.CLIMAX]: "Climax",
  [SectionType.RESOLUTION]: "Resolution"
};

export const FRAMEWORK_LABELS: Record<Framework, string> = {
  [Framework.THREE_ACT]: "Three-Act Structure",
  [Framework.SAVE_THE_CAT]: "Save the Cat",
  [Framework.HERO_JOURNEY]: "Hero's Journey"
};

export const CHECKLIST_PROMPTS: Record<SectionType, string[]> = {
  [SectionType.INCITING_INCIDENT]: [
    "What event disrupts the protagonist's normal life?",
    "How does this incident force the protagonist to act?",
    "What's at stake if the protagonist doesn't respond?"
  ],
  [SectionType.PLOT_POINT_1]: [
    "What choice does the protagonist make to enter Act 2?",
    "How does this decision change their goal?",
    "What new world or situation are they entering?"
  ],
  [SectionType.MIDPOINT]: [
    "What major revelation or event occurs?",
    "How does this change the protagonist's understanding?",
    "Does the protagonist shift from reactive to proactive?"
  ],
  [SectionType.PLOT_POINT_2]: [
    "What is the protagonist's darkest moment?",
    "What do they learn or realize?",
    "How do they decide to face the final challenge?"
  ],
  [SectionType.CLIMAX]: [
    "What is the final confrontation or challenge?",
    "How does the protagonist demonstrate their growth?",
    "What's the outcome of this confrontation?"
  ],
  [SectionType.RESOLUTION]: [
    "How are loose ends tied up?",
    "What's the protagonist's new normal?",
    "What lasting change has occurred?"
  ]
};