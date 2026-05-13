// frontend/src/lib/constants.ts

import { SectionType, Framework } from '../types';
import type { BreakdownCategory } from '../types';

// API Configuration — reuses multitalk's environment detection so it works both
// in dev (Vite proxy → localhost) and production (full Heroku URL).
import { config } from '../../../config/environment';
export const API_BASE_URL = import.meta.env.VITE_SW_API_URL || `${config.apiBaseUrl}/screenwriter`;
export const API_TIMEOUT = 30000; // 30 seconds
export const CHAT_TIMEOUT = 120000; // 2 minutes for agent chat/review

// Authentication — dedicated key so it doesn't conflict with multitalk's vapai-auth-token
export const AUTH_TOKEN_KEY = 'sw-auth-token';
export const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000; // 5 minutes before expiry

// Application Settings
export const APP_NAME = 'Film Automation Studio';
export const APP_VERSION = '1.0.0';

// UI Constants
export const DEBOUNCE_DELAY = 300; // milliseconds
export const TOAST_DURATION = 5000; // 5 seconds
export const MAX_SECTION_LENGTH = 1500; // characters
export const MIN_REVIEW_TEXT_LENGTH = 20; // characters

// Keyboard Shortcuts
export const KEYBOARD_SHORTCUTS = {
  SAVE: ['cmd+s', 'ctrl+s'],
  REVIEW: ['cmd+enter', 'ctrl+enter'],
  NEW_PROJECT: ['cmd+n', 'ctrl+n'],
  SEARCH: ['cmd+k', 'ctrl+k'],
  ESCAPE: ['escape', 'esc']
} as const;

// Framework Configuration
export const FRAMEWORK_CONFIG = {
  [Framework.THREE_ACT]: {
    name: 'Three-Act Structure',
    description: 'Classic screenplay structure divided into three acts',
    sections: [
      SectionType.INCITING_INCIDENT,
      SectionType.PLOT_POINT_1,
      SectionType.MIDPOINT,
      SectionType.PLOT_POINT_2,
      SectionType.CLIMAX,
      SectionType.RESOLUTION
    ]
  },
  [Framework.SAVE_THE_CAT]: {
    name: 'Save the Cat',
    description: 'Blake Snyder\'s popular screenwriting method',
    sections: [
      SectionType.INCITING_INCIDENT,
      SectionType.PLOT_POINT_1,
      SectionType.MIDPOINT,
      SectionType.PLOT_POINT_2,
      SectionType.CLIMAX,
      SectionType.RESOLUTION
    ]
  },
  [Framework.HERO_JOURNEY]: {
    name: 'Hero\'s Journey',
    description: 'Joseph Campbell\'s monomyth structure',
    sections: [
      SectionType.INCITING_INCIDENT,
      SectionType.PLOT_POINT_1,
      SectionType.MIDPOINT,
      SectionType.PLOT_POINT_2,
      SectionType.CLIMAX,
      SectionType.RESOLUTION
    ]
  }
} as const;

// Section Configuration
export const SECTION_CONFIG = {
  [SectionType.INCITING_INCIDENT]: {
    title: 'Inciting Incident',
    description: 'The event that disrupts the protagonist\'s normal life',
    order: 1,
    minWords: 50,
    maxWords: 500
  },
  [SectionType.PLOT_POINT_1]: {
    title: 'Plot Point 1',
    description: 'The event that propels the story into Act 2',
    order: 2,
    minWords: 50,
    maxWords: 500
  },
  [SectionType.MIDPOINT]: {
    title: 'Midpoint',
    description: 'The major turning point in the middle of the story',
    order: 3,
    minWords: 50,
    maxWords: 500
  },
  [SectionType.PLOT_POINT_2]: {
    title: 'Plot Point 2',
    description: 'The event that propels the story into Act 3',
    order: 4,
    minWords: 50,
    maxWords: 500
  },
  [SectionType.CLIMAX]: {
    title: 'Climax',
    description: 'The highest point of tension and conflict',
    order: 5,
    minWords: 50,
    maxWords: 500
  },
  [SectionType.RESOLUTION]: {
    title: 'Resolution',
    description: 'How the story wraps up',
    order: 6,
    minWords: 50,
    maxWords: 500
  }
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  GENERIC: 'An unexpected error occurred. Please try again.',
  NETWORK: 'Unable to connect to the server. Please check your connection.',
  UNAUTHORIZED: 'Please log in to continue.',
  FORBIDDEN: 'You don\'t have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  VALIDATION: 'Please check your input and try again.',
  SERVER_ERROR: 'Server error. Please try again later.',
  TIMEOUT: 'Request timed out. Please try again.'
} as const;

// Success Messages
export const SUCCESS_MESSAGES = {
  PROJECT_CREATED: 'Project created successfully',
  PROJECT_UPDATED: 'Project updated successfully',
  PROJECT_DELETED: 'Project deleted successfully',
  SECTION_SAVED: 'Section saved successfully',
  REVIEW_COMPLETE: 'AI review completed',
  SETTINGS_SAVED: 'Settings saved successfully'
} as const;

// Local Storage Keys
export const STORAGE_KEYS = {
  THEME: 'theme',
  LAST_PROJECT_ID: 'last_project_id',
  SIDEBAR_COLLAPSED: 'sidebar_collapsed',
  PREFERRED_FRAMEWORK: 'preferred_framework',
  AUTOSAVE_ENABLED: 'autosave_enabled',
  SIDEBAR_CHAT_WIDTH: 'sidebar_chat_width',
  CHAT_SIDEBAR_WIDTH: 'chat_sidebar_width',
  SIDEBAR_CHAT_PANEL_MODE: 'sidebar_chat_panel_mode',
  LAST_PHASE: 'last_phase',
  LAST_SUBSECTION: 'last_subsection',
  BREAKDOWN_LEFT_WIDTH: 'breakdown_left_width',
  BREAKDOWN_RIGHT_WIDTH: 'breakdown_right_width',
  BREAKDOWN_LEFT_COLLAPSED: 'breakdown_left_collapsed',
  BREAKDOWN_RIGHT_COLLAPSED: 'breakdown_right_collapsed',
  BREAKDOWN_LEFT_PANEL_VIEW: 'breakdown_left_panel_view',
} as const;

// Query Keys for React Query
export const QUERY_KEYS = {
  PROJECTS: 'projects',
  PROJECT: (id: string) => ['project', id],
  PROJECT_V2: (id: string) => ['project-v2', id],
  SECTION: (id: string) => ['section', id],
  USER: 'user',
  SETTINGS: 'settings',
  BOOKS: 'books',
  BOOK: (id: string) => ['book', id],
  BOOK_CONCEPTS: (id: string) => ['book-concepts', id],
  SNIPPETS: (bookId: string) => ['snippets', bookId],
  AGENTS: 'agents',
  AGENT_TAGS: 'agent_tags',
  CHAT_SESSIONS: (projectId: string) => ['chat-sessions', projectId],
  CHAT_MESSAGES: (sessionId: string) => ['chat-messages', sessionId],
  TEMPLATES: 'templates',
  TEMPLATE: (id: string) => ['template', id],
  PHASE_DATA: (projectId: string, phase: string) => ['phase-data', projectId, phase],
  SUBSECTION_DATA: (projectId: string, phase: string, key: string) => ['subsection-data', projectId, phase, key],
  LIST_ITEMS: (phaseDataId: string) => ['list-items', phaseDataId],
  LIST_ITEM: (id: string) => ['list-item', id],
  READINESS: (projectId: string, phase: string) => ['readiness', projectId, phase],
  AI_SESSIONS: (projectId: string) => ['ai-sessions', projectId],
  AI_MESSAGES: (sessionId: string) => ['ai-messages', sessionId],
  WIZARD_RUN: (id: string) => ['wizard-run', id],
  PIPELINE_MAP: 'pipeline-map',
  BREAKDOWN_SUMMARY: (projectId: string) => ['breakdown-summary', projectId] as const,
  BREAKDOWN_ELEMENTS: (projectId: string, category?: string) => ['breakdown-elements', projectId, category] as const,
  SHOTS: (projectId: string) => ['shots', projectId] as const,
  ELEMENT_MEDIA: (elementId: string) => ['element-media', elementId] as const,
  PROJECT_MEDIA: (projectId: string) => ['project-media', projectId] as const,
  STORYBOARD_FRAMES: (shotId: string) => ['storyboard-frames', shotId] as const,
  BREAKDOWN_ELEMENT: (elementId: string) => ['breakdown-element', elementId] as const,
  PROFILE: 'profile',
  SHOWS: 'shows',
  SHOW: (id: string) => ['show', id] as const,
  BIBLE: (id: string) => ['bible', id] as const,
  EPISODES: (showId: string) => ['episodes', showId] as const,
  API_KEYS: 'api-keys',
  SNAPSHOTS: (projectId: string) => ['snapshots', projectId] as const,
  SNAPSHOT: (projectId: string, snapshotId: string) => ['snapshot', projectId, snapshotId] as const,
  CURRENT_STATE: (projectId: string) => ['current-state', projectId] as const,
} as const;

// Theme Configuration
export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
} as const;

// Editor Configuration
export const EDITOR_CONFIG = {
  AUTOSAVE_DELAY: 1000, // 1 second
  WORD_COUNT_UPDATE_DELAY: 200, // 200ms
  PLACEHOLDER_TEXT: 'Start writing your story...',
  MAX_UNDO_HISTORY: 50
} as const;

// Review Configuration
export const REVIEW_CONFIG = {
  MAX_ISSUES: 10,
  MAX_SUGGESTIONS: 10,
  CACHE_DURATION: 15 * 60 * 1000 // 15 minutes
} as const;

// Pagination
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100]
} as const;

// File Upload
export const FILE_UPLOAD = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['text/plain', 'application/pdf', 'application/msword'],
  ALLOWED_EXTENSIONS: ['.txt', '.pdf', '.doc', '.docx']
} as const;

// Feature Flags
export const FEATURE_FLAGS = {
  COLLABORATION: false,
  EXPORT_PDF: false,
  IMPORT_SCRIPTS: true,
  ADVANCED_AI: false,
  DARK_MODE: true
} as const;

// Route Paths
export const ROUTES = {
  HOME: '/',
  PROJECTS: '/projects',
  PROJECT: (id: string) => `/projects/${id}`,
  PROJECT_WORKSPACE: (id: string, phase?: string, subsectionKey?: string, itemId?: string) => {
    let path = `/projects/${id}`;
    if (phase) path += `/${phase}`;
    if (subsectionKey) path += `/${subsectionKey}`;
    if (itemId) path += `/${itemId}`;
    return path;
  },
  BOOKS: '/books',
  SNIPPETS: '/snippets',
  TEMPLATES: '/templates',
  AI_ASSISTANT: '/ai-assistant',
  SETTINGS: '/settings',
  HELP: '/help',
  LOGIN: '/login',
  SIGNUP: '/signup',
  REGISTER: '/register',
  PROFILE: '/settings/profile',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',
  PROJECT_BREAKDOWN: (id: string) => `/projects/${id}/breakdown`,
  PROJECT_STORYBOARD: (id: string) => `/projects/${id}/storyboard`,
  ELEMENT_DETAIL: (projectId: string, elementId: string) => `/projects/${projectId}/breakdown/elements/${elementId}`,
  SHOW: (id: string) => `/shows/${id}`,
  API_KEYS: '/settings/api-keys',
} as const;

export const BREAKDOWN_CATEGORIES: Array<{ value: BreakdownCategory; label: string }> = [
  { value: 'character', label: 'Characters' },
  { value: 'location', label: 'Locations' },
  { value: 'prop', label: 'Props' },
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'vehicle', label: 'Vehicles' },
];

export const CATEGORY_COLORS: Record<BreakdownCategory, string> = {
  character: 'rgb(251, 191, 36)',   // amber-400
  location:  'rgb(96, 165, 250)',   // blue-400
  prop:      'rgb(74, 222, 128)',   // green-400
  wardrobe:  'rgb(192, 132, 252)', // purple-400
  vehicle:   'rgb(248, 113, 113)', // red-400
};

export const ELEMENT_EXTENDED_FIELDS: Record<BreakdownCategory, Array<{ key: string; label: string; type: 'text' | 'textarea' }>> = {
  character: [
    { key: 'bio', label: 'Biography', type: 'textarea' },
    { key: 'age', label: 'Age', type: 'text' },
    { key: 'role', label: 'Role', type: 'text' },
  ],
  location: [
    { key: 'address', label: 'Address', type: 'text' },
    { key: 'type', label: 'Type', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  prop: [
    { key: 'specs', label: 'Specifications', type: 'textarea' },
    { key: 'owner', label: 'Owner', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
  ],
  wardrobe: [
    { key: 'specs', label: 'Specifications', type: 'textarea' },
    { key: 'owner', label: 'Owner / Wearer', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
  ],
  vehicle: [
    { key: 'specs', label: 'Specifications', type: 'textarea' },
    { key: 'owner', label: 'Owner / Driver', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
  ],
};

export const BIBLE_SECTIONS = [
  { key: 'bible_characters', label: 'Characters', placeholder: 'Describe your main and recurring characters...' },
  { key: 'bible_world_setting', label: 'World / Setting', placeholder: 'Describe the world, time period, and locations...' },
  { key: 'bible_season_arc', label: 'Season Arc', placeholder: 'Outline the overarching story arc for the season...' },
  { key: 'bible_tone_style', label: 'Tone & Style', placeholder: 'Describe the visual style, tone, and mood...' },
] as const;

export const DURATION_PRESETS = [
  { value: 10, label: '10 min' },
  { value: 22, label: '22 min' },
  { value: 44, label: '44 min' },
  { value: 60, label: '60 min' },
  { value: -1, label: 'Custom...' },
] as const;

export const ORCHESTRATOR_PROMPT_TEMPLATE = `You are {name}, an orchestrator agent that coordinates multiple specialized screenwriting consultants. You synthesize insights from book-based and tag-based agents to provide comprehensive, well-rounded guidance.

## Sub-Agent Responses
{agent_responses}

## Writer's Project
{project_context}

Synthesize the above into a cohesive, actionable response for the writer.`;