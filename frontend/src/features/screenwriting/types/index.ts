// frontend/src/types/index.ts

// Using const objects instead of enum to satisfy erasableSyntaxOnly in multitalk's tsconfig
export const SectionType = {
  INCITING_INCIDENT: "inciting_incident",
  PLOT_POINT_1: "plot_point_1",
  MIDPOINT: "midpoint",
  PLOT_POINT_2: "plot_point_2",
  CLIMAX: "climax",
  RESOLUTION: "resolution",
} as const;
export type SectionType = typeof SectionType[keyof typeof SectionType];

export const ChecklistStatus = {
  PENDING: "pending",
  COMPLETE: "complete",
} as const;
export type ChecklistStatus = typeof ChecklistStatus[keyof typeof ChecklistStatus];

export const Framework = {
  THREE_ACT: "three_act",
  SAVE_THE_CAT: "save_the_cat",
  HERO_JOURNEY: "hero_journey",
} as const;
export type Framework = typeof Framework[keyof typeof Framework];

export interface ChecklistItem {
  id: string;
  section_id: string;
  prompt: string;
  answer: string;
  status: ChecklistStatus;
  order: number;
}

export interface AIFeedback {
  issues: string[];
  suggestions: string[];
}

export interface Section {
  id: string;
  project_id: string;
  type: SectionType;
  user_notes: string;
  ai_suggestions: AIFeedback;
  updated_at: string | null;
  checklist_items: ChecklistItem[];
}

export interface Project {
  id: string;
  owner_id: string;
  title: string;
  framework: Framework;
  storyboard_style?: string | null;
  created_at: string;
  updated_at: string | null;
  show_id?: string | null;
  episode_number?: number | null;
  sections: Section[];
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  display_name?: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface UserUpdate {
  display_name?: string;
}

export interface ReviewRequest {
  section_id: string;
  text: string;
  framework: Framework;
}

export interface ReviewResponse {
  issues: string[];
  suggestions: string[];
}

// ============================================================
// Book types
// ============================================================

export type BookStatus = 'pending' | 'extracting' | 'analyzing' | 'embedding' | 'completed' | 'failed' | 'paused';

export interface Book {
  id: string;
  title: string;
  author: string | null;
  filename: string;
  file_type: string;
  file_size_bytes: number;
  status: BookStatus;
  processing_step: string | null;
  processing_error: string | null;
  progress: number;
  chapters_total: number;
  chapters_processed: number;
  total_chunks: number;
  total_concepts: number;
  uploaded_at: string;
  processed_at: string | null;
}

export interface Concept {
  id: string;
  name: string;
  definition: string;
  chapter_source: string | null;
  page_range: string | null;
  examples: Array<{ film: string; description: string; page?: string | null }>;
  actionable_questions: string[];
  section_relevance: Record<string, number>;
  tags: string[];
}

// ============================================================
// Agent types
// ============================================================

export type AgentType = 'book_based' | 'tag_based' | 'orchestrator';

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  personality: string | null;
  color: string;
  icon: string;
  is_active: boolean;
  is_default: boolean;
  agent_type: AgentType;
  tags_filter: string[];
  created_at: string;
  book_count: number;
}

// ============================================================
// Chat types
// ============================================================

export interface ChatSession {
  id: string;
  agent_id: string;
  project_id: string;
  title: string | null;
  agent_name?: string;
  agent_color?: string;
  agent_icon?: string;
  created_at: string;
  updated_at: string | null;
}

export interface BookReference {
  concept_name?: string;
  book_title?: string;
  chapter?: string;
  page?: string;
}

export interface ConsultedAgent {
  agent_id: string;
  name: string;
  color: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  message_type: 'chat' | 'review' | 'system';
  book_references: BookReference[];
  consulted_agents: ConsultedAgent[];
  created_at: string;
}

// ============================================================
// Multi-agent review types
// ============================================================

export interface AgentReviewResult {
  agent_id: string;
  agent_name: string;
  agent_color: string;
  agent_icon: string;
  issues: string[];
  suggestions: string[];
  book_references: BookReference[];
  status: 'completed' | 'error';
  error?: string;
}

// ============================================================
// Pipeline Map types (Phase 7)
// ============================================================

export interface PipelineMapEntry {
  id: string;
  owner_id: string;
  agent_id: string;
  phase: string;
  subsection_key: string;
  confidence: number;
  rationale: string | null;
  pipeline_dirty: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface PipelineMapResponse {
  owner_id: string;
  entries: PipelineMapEntry[];
  total_mappings: number;
}

// Re-export template types
export * from './template';

// ============================================================
// Snippet Manager (Phase 2)
// ============================================================

export interface Snippet {
  id: string;
  book_id: string;
  chapter_title: string | null;
  page_number: number | null;
  content: string;
  justification: string | null;
  concept_ids: string[];
  concept_names: string[];
  token_count: number;
  is_deleted: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface SnippetListResponse {
  items: Snippet[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
  book_status: string;
}

// ============================================================
// Breakdown types (v2.0 — Phase 13)
// ============================================================

export type BreakdownCategory = 'character' | 'location' | 'prop' | 'wardrobe' | 'vehicle';

export interface SceneLink {
  id: string;
  scene_item_id: string;
  context: string;
  source: 'ai' | 'user';
  scene_title?: string;
}

export interface BreakdownElement {
  id: string;
  project_id: string;
  category: BreakdownCategory;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  source: 'ai' | 'user';
  user_modified: boolean;
  is_deleted: boolean;
  sort_order: number;
  scene_links: SceneLink[];
  synced_to_characters: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface BreakdownRun {
  id: string;
  project_id: string;
  status: string;
  config: Record<string, unknown>;
  result_summary: Record<string, unknown>;
  elements_created: number;
  elements_updated: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface BreakdownSummary {
  project_id: string;
  is_stale: boolean;
  total_elements: number;
  counts_by_category: Record<BreakdownCategory, number>;
  last_run: BreakdownRun | null;
}

export interface BreakdownElementCreate {
  category: BreakdownCategory;
  name: string;
  description: string;
}

export interface BreakdownElementUpdate {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtendedFieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea';
}

// ============================================================
// Shot types (v3.0 — Phase 20)
// ============================================================

export interface ShotFields {
  shot_size?: string;
  camera_angle?: string;
  camera_movement?: string;
  lens?: string;
  description?: string;
  action?: string;
  dialogue?: string;
  sound?: string;
  characters?: string;
  environment?: string;
  props?: string;
  equipment?: string;
  notes?: string;
}

export interface Shot {
  id: string;
  project_id: string;
  scene_item_id: string | null;
  shot_number: number;
  script_text: string;
  script_range: Record<string, unknown>;
  fields: ShotFields;
  sort_order: number;
  source: 'user' | 'ai';
  ai_generated: boolean;
  user_modified: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface ShotCreate {
  scene_item_id?: string | null;
  shot_number?: number;
  script_text?: string;
  fields?: Partial<ShotFields>;
  sort_order?: number;
  source?: 'user' | 'ai';
}

export interface ShotUpdate {
  scene_item_id?: string | null;
  shot_number?: number;
  script_text?: string;
  fields?: Partial<ShotFields>;
  sort_order?: number;
}

// ============================================================
// Asset Media types (v3.0 — Phase 23)
// ============================================================

export interface AssetMedia {
  id: string;
  project_id: string;
  element_id: string | null;
  shot_id: string | null;
  file_type: 'image' | 'audio';
  file_path: string;
  thumbnail_path: string | null;
  original_filename: string;
  file_size_bytes: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string | null;
}

// ============================================================
// Breakdown Chat types (v3.0 — Phase 24)
// ============================================================

export interface BreakdownChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  shot_action?: ShotAction | null;
}

export interface ShotAction {
  type: 'create' | 'modify';
  shot_id?: string;       // only for 'modify'
  data: {
    scene_item_id?: string | null;
    shot_number?: number;
    fields?: Partial<ShotFields>;
  };
}

// ============================================================
// Storyboard (v3.2 — Phase 29)
// ============================================================

export type GenerationSource = 'user' | 'ai';
export type StoryboardStyle = 'photorealistic' | 'cinematic' | 'animated';

export interface StoryboardFrame {
  id: string;
  shot_id: string;
  file_path: string;
  thumbnail_path: string | null;
  file_type: 'image' | 'video';
  is_selected: boolean;
  generation_source: GenerationSource;
  generation_style: StoryboardStyle | null;
  created_at: string;
  updated_at: string | null;
}

// ============================================================
// Show types (v4.2 -- Phase 38)
// ============================================================

export interface Show {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string | null;
}

export interface ShowCreate {
  title: string;
  description?: string;
}

export interface BibleResponse {
  show_id: string;
  bible_characters: string;
  bible_world_setting: string;
  bible_season_arc: string;
  bible_tone_style: string;
  episode_duration_minutes: number | null;
}

export interface BibleUpdate {
  bible_characters?: string;
  bible_world_setting?: string;
  bible_season_arc?: string;
  bible_tone_style?: string;
  episode_duration_minutes?: number | null;
}

// ============================================================
// API Key types (v5.0 -- Phase 43)
// ============================================================

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  request_count: number;
  is_active: boolean;
}

export interface ApiKeyCreate {
  name: string;
  scopes?: string[];
  expires_at?: string | null;
}

export interface ApiKeyCreateResponse extends ApiKey {
  key: string; // Full key, shown once
}

// ============================================================
// Snapshot types (Phase 48)
// ============================================================

export interface Snapshot {
  id: string;
  project_id: string;
  label: string | null;
  trigger_type: 'manual' | 'auto_wizard' | 'auto_yolo' | 'pre_restore';
  metadata: {
    phase_data_count: number;
    list_item_count: number;
    screenplay_count: number;
    blob_bytes: number;
  } | null;
  version: number;
  created_at: string;
}

export interface SnapshotDetail extends Snapshot {
  data: SnapshotData;
}

export interface SnapshotListResponse {
  items: Snapshot[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface RestoreResponse {
  safety_snapshot_id: string;
  restored_snapshot_id: string;
  phase_data_count: number;
  list_item_count: number;
  screenplay_count: number;
}

// ============================================================
// Comparison types (Phase 49)
// ============================================================

export interface SnapshotData {
  version: number;
  phase_data: Array<{
    id: string;
    phase: string;
    subsection_key: string;
    content: Record<string, unknown>;
    list_items: Array<{
      id: string;
      item_type: string;
      content: Record<string, unknown>;
    }>;
  }>;
  screenplay_content: Array<{
    id: string;
    content: string;
  }>;
}

export interface RemoveScreenplayResponse {
  safety_snapshot_id: string;
  removed_screenplay_count: number;
  cleared_phase_data_count: number;
}