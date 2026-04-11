// frontend/src/types/template.ts

export type TemplateType = 'short_movie';
export type PhaseType = 'idea' | 'story' | 'scenes' | 'write';

export type UIPattern =
  | 'wizard'
  | 'wizard_with_chat'
  | 'import_wizard'
  | 'structured_form'
  | 'repeatable_cards'
  | 'card_grid'
  | 'ordered_list'
  | 'individual_editor'
  | 'screenplay_editor'
  | 'analyzer';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number';
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  min_length?: number;
  max_length?: number;
  column?: number;
  full_width?: boolean;
}

export interface FieldGroup {
  label: string | null;
  description?: string;
  fields: FieldDef[];
}

export interface CardGroupDef {
  key: string;
  label: string;
  description?: string;
  item_type: string;
  fields: FieldDef[];
  min_items?: number;
  max_items?: number;
}

export interface AIActionDef {
  key: string;
  label: string;
  icon?: string;
  prompt_template?: string;
  result_target?: string;
}

export interface ReadinessCheck {
  label: string;
  phase: string;
  subsection_key: string;
  field_count: number;
}

export interface WizardApproach {
  key: string;
  name: string;
  description: string;
}

export interface CountOption {
  value: string;
  label: string;
}

export interface WizardConfig {
  approaches?: WizardApproach[];
  count_options?: CountOption[];
  default_count?: string | number;
  readiness_checks?: ReadinessCheck[];
  duration_selector?: boolean;
  duration_options?: Array<{ value: number; label: string }>;
  duration_description?: string;
  episode_selector?: boolean;
  episode_selector_max?: number;
  generate_button?: string;
}

export interface ListConfig {
  item_type: string;
  sortable?: boolean;
  summary_field?: string;
  show_status?: boolean;
}

export interface EditorConfig {
  layout?: 'single_column' | 'two_column';
  fields: FieldDef[];
}

export interface SubsectionConfig {
  key: string;
  name: string;
  description?: string;
  ui_pattern: UIPattern;
  fields?: FieldDef[];
  field_groups?: FieldGroup[];
  card_groups?: CardGroupDef[];
  ai_actions?: AIActionDef[];
  sidebar_chat?: boolean;
  chat_system_prompt?: string;
  wizard_config?: WizardConfig;
  list_config?: ListConfig;
  editor_config?: EditorConfig;
  columns?: number;
  cards?: FieldDef[];
  grid_columns?: number;
  linked_cards_source?: string;
}

export interface PhaseConfig {
  id: PhaseType;
  name: string;
  order: number;
  subsections: SubsectionConfig[];
}

export interface TemplateConfig {
  id: TemplateType;
  name: string;
  description: string;
  icon: string;
  phases: PhaseConfig[];
}

export interface TemplateListItem {
  id: TemplateType;
  name: string;
  description: string;
  icon: string;
}

// Phase data types
export interface PhaseDataResponse {
  id: string;
  project_id: string;
  phase: PhaseType;
  subsection_key: string;
  content: Record<string, any>;
  ai_suggestions: Record<string, any>;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ListItemResponse {
  id: string;
  phase_data_id: string;
  item_type: string;
  sort_order: number;
  content: Record<string, any>;
  ai_suggestions: Record<string, any>;
  status: string;
  created_at: string;
  updated_at: string;
}

// AI types
export interface AISessionResponse {
  id: string;
  project_id: string;
  phase: PhaseType;
  subsection_key: string;
  context_item_id?: string;
  created_at: string;
}

export interface AIMessageResponse {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  message_type: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface WizardRunResponse {
  id: string;
  project_id: string;
  wizard_type: string;
  phase: PhaseType;
  config: Record<string, any>;
  result: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error_message?: string;
  created_at: string;
  completed_at?: string;
}

// YOLO auto-fill events
export interface YoloEvent {
  type: 'start' | 'progress' | 'done';
  total?: number;
  key?: string;
  name?: string;
  index?: number;
  phase?: string;
  strategy?: string;
  status?: 'running' | 'done' | 'skipped' | 'error';
  detail?: string;
  completed?: number;
  skipped?: number;
  errors?: number;
}

// Template-based project
export interface ProjectV2 {
  id: string;
  owner_id: string;
  title: string;
  template: TemplateType;
  current_phase: PhaseType;
  created_at: string;
  updated_at: string | null;
}
