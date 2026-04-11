// frontend/src/lib/api.ts

import type {
  Project, Section, ChecklistItem, ReviewRequest, ReviewResponse,
  Book, Concept, Agent, AgentType, ChatSession, ChatMessage,
  TemplateConfig, TemplateListItem, PhaseDataResponse, ListItemResponse,
  AISessionResponse, AIMessageResponse, WizardRunResponse, ProjectV2,
  Snippet, SnippetListResponse, PipelineMapResponse,
  Shot, ShotCreate, ShotUpdate, AssetMedia, StoryboardFrame,
  Show, ShowCreate, BibleResponse, BibleUpdate,
  ApiKey, ApiKeyCreate, ApiKeyCreateResponse,
  SnapshotListResponse, SnapshotDetail, Snapshot, RestoreResponse,
  SnapshotData, RemoveScreenplayResponse,
  AuthResponse, LoginRequest, RegisterRequest, UserUpdate, User,
} from '../types';
import type { YoloEvent } from '../types/template';
import { API_BASE_URL, AUTH_TOKEN_KEY, API_TIMEOUT, CHAT_TIMEOUT } from './constants';

// Get auth token from localStorage or use mock token for development
const getAuthToken = () => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? `Bearer ${token}` : 'Bearer mock-token';
};

const getHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'Authorization': getAuthToken()
});

// Create a fetch wrapper with timeout
const fetchWithTimeout = async (url: string, options: RequestInit = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
};

export const api = {
  // Auth
  async getMockToken(): Promise<{ access_token: string; token_type: string }> {
    const response = await fetch(`${API_BASE_URL}/auth/token/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Failed to get mock token');
    return response.json();
  },

  async requestMagicLink(email: string): Promise<{ message: string; magic_link: string }> {
    const response = await fetch(`${API_BASE_URL}/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!response.ok) throw new Error('Failed to request magic link');
    return response.json();
  },

  async verifyMagicLink(token: string): Promise<{ access_token: string; token_type: string }> {
    const response = await fetch(`${API_BASE_URL}/auth/verify-magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!response.ok) throw new Error('Failed to verify magic link');
    return response.json();
  },

  async register(data: RegisterRequest): Promise<AuthResponse> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Registration failed' }));
      throw new Error(error.detail || 'Registration failed');
    }
    return response.json();
  },

  async login(data: LoginRequest): Promise<AuthResponse> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(error.detail || 'Login failed');
    }
    return response.json();
  },

  async getProfile(): Promise<User> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/auth/me`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch profile');
    return response.json();
  },

  async updateProfile(data: UserUpdate): Promise<User> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/auth/me`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update profile');
    return response.json();
  },

  // Projects
  async getProjects(): Promise<Project[]> {
    const response = await fetch(`${API_BASE_URL}/projects/`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch projects');
    return response.json();
  },

  async getProject(id: string): Promise<Project> {
    const response = await fetch(`${API_BASE_URL}/projects/${id}`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch project');
    return response.json();
  },

  async createProject(data: { title: string; framework: string }): Promise<Project> {
    const response = await fetch(`${API_BASE_URL}/projects/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create project');
    return response.json();
  },

  async updateProject(id: string, data: Partial<Project>): Promise<Project> {
    const response = await fetch(`${API_BASE_URL}/projects/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update project');
    return response.json();
  },

  async deleteProject(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/projects/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to delete project');
  },

  // Sections
  async getSection(id: string): Promise<Section> {
    const response = await fetch(`${API_BASE_URL}/sections/${id}`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch section');
    return response.json();
  },

  async updateSection(id: string, data: { user_notes: string }): Promise<Section> {
    const response = await fetch(`${API_BASE_URL}/sections/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update section');
    return response.json();
  },

  // Checklist items
  async createChecklistItem(sectionId: string, data: Partial<ChecklistItem>): Promise<ChecklistItem> {
    const response = await fetch(`${API_BASE_URL}/sections/${sectionId}/checklist`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create checklist item');
    return response.json();
  },

  async updateChecklistItem(itemId: string, data: Partial<ChecklistItem>): Promise<ChecklistItem> {
    const response = await fetch(`${API_BASE_URL}/sections/checklist/${itemId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update checklist item');
    return response.json();
  },

  // Review
  async reviewSection(data: ReviewRequest): Promise<ReviewResponse> {
    const response = await fetch(`${API_BASE_URL}/review/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to get review');
    return response.json();
  },

  // ============================================================
  // Books
  // ============================================================

  async uploadBook(formData: FormData): Promise<{ id: string; status: string; message: string }> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/books/upload`, {
      method: 'POST',
      headers: { 'Authorization': getAuthToken() },
      body: formData
    });
    if (!response.ok) throw new Error('Failed to upload book');
    return response.json();
  },

  async getBooks(): Promise<Book[]> {
    const response = await fetch(`${API_BASE_URL}/books/`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch books');
    return response.json();
  },

  async getBook(id: string): Promise<Book> {
    const response = await fetch(`${API_BASE_URL}/books/${id}`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch book');
    return response.json();
  },

  async getBookConcepts(bookId: string): Promise<Concept[]> {
    const response = await fetch(`${API_BASE_URL}/books/${bookId}/concepts`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch concepts');
    return response.json();
  },

  async deleteBook(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/books/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to delete book');
  },

  // ============================================================
  // Agents
  // ============================================================

  async getAgents(): Promise<Agent[]> {
    const response = await fetch(`${API_BASE_URL}/agents/`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch agents');
    return response.json();
  },

  async getAgentTags(): Promise<{ tags: string[] }> {
    const response = await fetch(`${API_BASE_URL}/agents/tags`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch agent tags');
    return response.json();
  },

  async createAgent(data: {
    name: string;
    description?: string;
    system_prompt_template: string;
    personality?: string;
    color: string;
    icon: string;
    agent_type: AgentType;
    tags_filter: string[];
  }): Promise<Agent> {
    const response = await fetch(`${API_BASE_URL}/agents/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create agent');
    return response.json();
  },

  async deleteAgent(agentId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/agents/${agentId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete agent');
  },

  async seedDefaultAgents(): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/agents/seed-defaults`, {
      method: 'POST',
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to seed default agents');
  },

  async linkBookToAgent(agentId: string, bookId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/agents/${agentId}/books/${bookId}`, {
      method: 'POST',
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to link book to agent');
  },

  async unlinkBookFromAgent(agentId: string, bookId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/agents/${agentId}/books/${bookId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to unlink book from agent');
  },

  async updateAgent(agentId: string, data: {
    name?: string;
    description?: string;
    system_prompt_template?: string;
    personality?: string;
    color?: string;
    icon?: string;
    is_active?: boolean;
    agent_type?: AgentType;
    tags_filter?: string[];
  }): Promise<Agent> {
    const response = await fetch(`${API_BASE_URL}/agents/${agentId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update agent');
    return response.json();
  },

  async getPipelineMap(): Promise<PipelineMapResponse> {
    const response = await fetch(`${API_BASE_URL}/agents/pipeline-map`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch pipeline map');
    return response.json();
  },

  // ============================================================
  // Chat
  // ============================================================

  async createChatSession(data: { agent_id: string; project_id: string; title?: string }): Promise<ChatSession> {
    const response = await fetch(`${API_BASE_URL}/chat/sessions`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create chat session');
    return response.json();
  },

  async getChatSessions(projectId?: string): Promise<ChatSession[]> {
    const url = projectId
      ? `${API_BASE_URL}/chat/sessions?project_id=${projectId}`
      : `${API_BASE_URL}/chat/sessions`;
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch chat sessions');
    return response.json();
  },

  async getChatMessages(sessionId: string): Promise<ChatMessage[]> {
    const response = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}/messages`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch messages');
    return response.json();
  },

  async sendChatMessage(sessionId: string, content: string): Promise<{ content: string; book_references: any[]; message_id: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ content }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to send message');
      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('Request timeout');
      throw error;
    }
  },

  async triggerChatReview(sessionId: string, sectionId: string): Promise<{ review: any; message_id: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}/review`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ section_id: sectionId }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to trigger review');
      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('Request timeout');
      throw error;
    }
  },

  async deleteChatSession(sessionId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to delete session');
  },

  async sendChatMessageStream(
    sessionId: string,
    content: string,
    onChunk: (chunk: string) => void,
    onDone: (data: { field_updates?: Record<string, string>; list_items_created?: number }) => void,
    fieldContext?: Record<string, unknown>,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT);
    try {
      const response = await fetch(`${API_BASE_URL}/chat/sessions/${sessionId}/messages/stream`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ content, field_context: fieldContext }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to send chat message');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') return;

          try {
            const data = JSON.parse(payload);
            if (data.chunk) {
              onChunk(data.chunk);
            } else if (data.field_updates !== undefined || data.done) {
              onDone({ field_updates: data.field_updates, list_items_created: data.list_items_created ?? 0 });
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('Request timeout');
      throw error;
    }
  },

  // ============================================================
  // Templates
  // ============================================================

  async getTemplates(): Promise<TemplateListItem[]> {
    const response = await fetch(`${API_BASE_URL}/templates/`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch templates');
    return response.json();
  },

  async getTemplate(id: string): Promise<TemplateConfig> {
    const response = await fetch(`${API_BASE_URL}/templates/${id}`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch template');
    return response.json();
  },

  // Template-based project creation
  async createProjectV2(data: { title: string; template: string }): Promise<ProjectV2> {
    const response = await fetch(`${API_BASE_URL}/projects/v2`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create project');
    return response.json();
  },

  // ============================================================
  // Phase Data
  // ============================================================

  async getPhaseData(projectId: string, phase: string): Promise<PhaseDataResponse[]> {
    const response = await fetch(`${API_BASE_URL}/phase-data/${projectId}/${phase}`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch phase data');
    return response.json();
  },

  async getSubsectionData(projectId: string, phase: string, subsectionKey: string): Promise<PhaseDataResponse> {
    const response = await fetch(`${API_BASE_URL}/phase-data/${projectId}/${phase}/${subsectionKey}`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch subsection data');
    return response.json();
  },

  async updateSubsectionData(projectId: string, phase: string, subsectionKey: string, content: Record<string, any>): Promise<PhaseDataResponse> {
    const response = await fetch(`${API_BASE_URL}/phase-data/${projectId}/${phase}/${subsectionKey}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ content })
    });
    if (!response.ok) throw new Error('Failed to update subsection data');
    return response.json();
  },

  async getReadiness(projectId: string, phase: string): Promise<Record<string, any>> {
    const response = await fetch(`${API_BASE_URL}/phase-data/${projectId}/readiness/${phase}`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch readiness');
    return response.json();
  },

  // ============================================================
  // List Items (Episodes, Scenes, Characters)
  // ============================================================

  async getListItems(phaseDataId: string): Promise<ListItemResponse[]> {
    const response = await fetch(`${API_BASE_URL}/list-items/${phaseDataId}`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch list items');
    return response.json();
  },

  async getListItem(itemId: string): Promise<ListItemResponse> {
    const response = await fetch(`${API_BASE_URL}/list-items/item/${itemId}`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch list item');
    return response.json();
  },

  async createListItem(phaseDataId: string, data: { item_type: string; content: Record<string, any>; sort_order?: number }): Promise<ListItemResponse> {
    const response = await fetch(`${API_BASE_URL}/list-items/${phaseDataId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create list item');
    return response.json();
  },

  async updateListItem(itemId: string, data: { content?: Record<string, any>; status?: string }): Promise<ListItemResponse> {
    const response = await fetch(`${API_BASE_URL}/list-items/item/${itemId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to update list item');
    return response.json();
  },

  async deleteListItem(itemId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/list-items/item/${itemId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to delete list item');
  },

  async reorderListItems(phaseDataId: string, items: Array<{ id: string; sort_order: number }>): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/list-items/${phaseDataId}/reorder`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ items })
    });
    if (!response.ok) throw new Error('Failed to reorder items');
  },

  // ============================================================
  // AI Chat (Template system)
  // ============================================================

  async lookupAISession(projectId: string, phase: string, subsectionKey: string, contextItemId?: string): Promise<AISessionResponse | null> {
    const params = new URLSearchParams({ project_id: projectId, phase, subsection_key: subsectionKey });
    if (contextItemId) params.set('context_item_id', contextItemId);
    const response = await fetch(`${API_BASE_URL}/ai/sessions/lookup?${params}`, {
      headers: getHeaders()
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to lookup AI session');
    return response.json();
  },

  async createAISession(data: { project_id: string; phase: string; subsection_key: string; context_item_id?: string }): Promise<AISessionResponse> {
    const response = await fetch(`${API_BASE_URL}/ai/sessions`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to create AI session');
    return response.json();
  },

  async getAIMessages(sessionId: string): Promise<AIMessageResponse[]> {
    const response = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/messages`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch AI messages');
    return response.json();
  },

  async sendAIMessage(sessionId: string, content: string, mode: 'brainstorm' | 'action' = 'brainstorm'): Promise<AIMessageResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT);
    try {
      const response = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ content, mode }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to send AI message');
      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('Request timeout');
      throw error;
    }
  },

  async sendAIMessageStream(
    sessionId: string,
    content: string,
    mode: 'brainstorm' | 'action' = 'brainstorm',
    onChunk: (chunk: string) => void,
    onDone: (data: { id?: string; metadata?: Record<string, any> }) => void,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT);
    try {
      const response = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}/messages/stream`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ content, mode }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to send AI message');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') return;

          try {
            const data = JSON.parse(payload);
            if (data.chunk) {
              onChunk(data.chunk);
            } else if (data.field_updates !== undefined) {
              // Action mode: field updates arrived after streaming completed
              onDone({ id: data.id, metadata: { field_updates: data.field_updates, applied: data.applied, list_items_created: data.list_items_created ?? 0 } });
            } else if (data.done) {
              onDone({ id: data.id });
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('Request timeout');
      throw error;
    }
  },

  async deleteAISession(sessionId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/ai/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to delete AI session');
  },

  async fillBlanks(data: { project_id: string; phase: string; subsection_key: string; item_id?: string; field_key?: string }): Promise<Record<string, any>> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/ai/fill-blanks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to fill blanks');
    return response.json();
  },

  async giveNotes(data: { project_id: string; phase: string; subsection_key: string; item_id?: string }): Promise<Record<string, any>> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/ai/give-notes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to get notes');
    return response.json();
  },

  async analyzeStructure(data: { project_id: string; phase: string; subsection_key: string }): Promise<Record<string, any>> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/ai/analyze-structure`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to analyze structure');
    return response.json();
  },

  // ============================================================
  // Wizards
  // ============================================================

  async runWizard(data: { project_id: string; wizard_type: string; phase: string; config: Record<string, any> }): Promise<WizardRunResponse> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/wizards/run`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Failed to run wizard');
    return response.json();
  },

  async getWizardRun(runId: string): Promise<WizardRunResponse> {
    const response = await fetch(`${API_BASE_URL}/wizards/${runId}`, {
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch wizard run');
    return response.json();
  },

  async applyWizardResults(runId: string): Promise<Record<string, any>> {
    const response = await fetch(`${API_BASE_URL}/wizards/${runId}/apply`, {
      method: 'POST',
      headers: getHeaders()
    });
    if (!response.ok) throw new Error('Failed to apply wizard results');
    return response.json();
  },

  // ============================================================
  // Snippet Manager (/api/snippets) — Phase 2
  // ============================================================

  async getSnippets(
    bookId: string,
    params: { page?: number; per_page?: number } = {}
  ): Promise<SnippetListResponse> {
    const p = new URLSearchParams({ book_id: bookId });
    if (params.page) p.set('page', String(params.page));
    if (params.per_page) p.set('per_page', String(params.per_page));
    const response = await fetch(`${API_BASE_URL}/snippets/?${p}`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch snippets');
    return response.json();
  },

  async editSnippet(snippetId: string, content: string): Promise<Snippet> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/snippets/${snippetId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error('Failed to update snippet');
    return response.json();
  },

  async deleteSnippet(snippetId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/snippets/${snippetId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete snippet');
  },

  // Fix pre-existing missing methods (BookManager.tsx calls these):
  async pauseBook(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/books/${id}/pause`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to pause book');
  },

  async resumeBook(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/books/${id}/resume`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to resume book');
  },

  async retryBook(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/books/${id}/retry`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to retry book');
  },

  // ============================================================
  // YOLO Auto-Fill
  // ============================================================

  // ============================================================
  // Breakdown (v2.0 — Phase 13)
  // ============================================================

  async getBreakdownSummary(projectId: string): Promise<import('../types').BreakdownSummary> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/breakdown/summary/${projectId}`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch breakdown summary');
    return response.json();
  },

  async getBreakdownElement(elementId: string): Promise<import('../types').BreakdownElement> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/breakdown/element/${elementId}`,
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch element');
    return response.json();
  },

  async getBreakdownElements(projectId: string, category?: string): Promise<import('../types').BreakdownElement[]> {
    const url = category
      ? `${API_BASE_URL}/breakdown/elements/${projectId}?category=${category}`
      : `${API_BASE_URL}/breakdown/elements/${projectId}`;
    const response = await fetchWithTimeout(url, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch breakdown elements');
    return response.json();
  },

  async createBreakdownElement(projectId: string, data: import('../types').BreakdownElementCreate): Promise<import('../types').BreakdownElement> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/breakdown/elements/${projectId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create breakdown element');
    return response.json();
  },

  async updateBreakdownElement(elementId: string, data: import('../types').BreakdownElementUpdate): Promise<import('../types').BreakdownElement> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/breakdown/element/${elementId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update breakdown element');
    return response.json();
  },

  async deleteBreakdownElement(elementId: string): Promise<void> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/breakdown/element/${elementId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete breakdown element');
  },

  async syncBreakdownElementToCharacters(
    elementId: string
  ): Promise<{ status: 'created' | 'already_exists'; list_item_id: string }> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/breakdown/element/${elementId}/sync-to-project`,
      {
        method: 'POST',
        headers: getHeaders(),
      }
    );
    if (!response.ok) throw new Error('Failed to sync element to characters');
    return response.json();
  },

  async triggerBreakdownExtraction(projectId: string): Promise<import('../types').BreakdownRun> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/breakdown/extract/${projectId}`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to trigger extraction');
    return response.json();
  },

  // ============================================================
  // Shots (v3.0 — Phase 20)
  // ============================================================

  async listShots(projectId: string): Promise<Shot[]> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shots/${projectId}`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch shots');
    return response.json();
  },

  async createShot(projectId: string, data: ShotCreate): Promise<Shot> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shots/${projectId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create shot');
    return response.json();
  },

  async updateShot(projectId: string, shotId: string, data: ShotUpdate): Promise<Shot> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shots/${projectId}/${shotId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update shot');
    return response.json();
  },

  async deleteShot(projectId: string, shotId: string): Promise<void> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shots/${projectId}/${shotId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete shot');
  },

  async reorderShots(projectId: string, items: Array<{ id: string; sort_order: number }>): Promise<void> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shots/${projectId}/reorder`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ items }),
    });
    if (!response.ok) throw new Error('Failed to reorder shots');
  },

  async getShotlistStatus(projectId: string): Promise<{ shotlist_stale: boolean; shot_count: number }> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shots/${projectId}/status`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch shotlist status');
    return response.json();
  },

  async acknowledgeShotlistStale(projectId: string): Promise<{ status: string }> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shots/${projectId}/acknowledge-stale`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to acknowledge shotlist staleness');
    return response.json();
  },

  async generateShotlist(projectId: string): Promise<{
    status: string;
    shots_created?: number;
    shots_deleted?: number;
    shots_preserved?: number;
    message?: string;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT);
    try {
      const response = await fetch(`${API_BASE_URL}/shots/${projectId}/generate`, {
        method: 'POST',
        headers: getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to generate shotlist');
      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('Request timeout');
      throw error;
    }
  },

  // ============================================================
  // Media (v3.0 — Phase 23)
  // ============================================================

  async listElementMedia(projectId: string, elementId: string): Promise<AssetMedia[]> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/media/${projectId}?element_id=${elementId}`,
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch element media');
    return response.json();
  },

  async uploadMedia(projectId: string, formData: FormData): Promise<AssetMedia> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/media/${projectId}`,
      {
        method: 'POST',
        headers: { 'Authorization': getAuthToken() },
        body: formData,
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail || 'Failed to upload media');
    }
    return response.json();
  },

  async deleteMedia(projectId: string, mediaId: string): Promise<void> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/media/${projectId}/${mediaId}`,
      {
        method: 'DELETE',
        headers: getHeaders(),
      }
    );
    if (!response.ok) throw new Error('Failed to delete media');
  },

  // ============================================================
  // Breakdown Chat (v3.0 — Phase 24)
  // ============================================================

  async sendBreakdownChatStream(
    projectId: string,
    content: string,
    messageHistory: Array<{ role: string; content: string }>,
    breakdownContext: { shots: any[]; elements: any[] },
    onChunk: (chunk: string) => void,
    onDone: (data: { shot_action?: any | null }) => void,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT);
    try {
      const response = await fetch(`${API_BASE_URL}/breakdown-chat/${projectId}/stream`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          content,
          message_history: messageHistory,
          shots_context: breakdownContext.shots,
          elements_context: breakdownContext.elements,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to send breakdown chat message');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') return;
          try {
            const data = JSON.parse(payload);
            if (data.chunk) onChunk(data.chunk);
            else if (data.done) onDone({ shot_action: data.shot_action ?? null });
          } catch { /* skip malformed */ }
        }
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('Request timeout');
      throw error;
    }
  },

  // ============================================================
  // Storyboard (v3.2 — Phase 29)
  // ============================================================

  async uploadFrame(projectId: string, shotId: string, formData: FormData): Promise<StoryboardFrame> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/storyboard/${projectId}/shots/${shotId}/frames`,
      {
        method: 'POST',
        headers: { 'Authorization': getAuthToken() },
        body: formData,
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail || 'Failed to upload frame');
    }
    return response.json();
  },

  async listFrames(projectId: string, shotId: string): Promise<StoryboardFrame[]> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/storyboard/${projectId}/shots/${shotId}/frames`,
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch frames');
    return response.json();
  },

  async updateFrame(projectId: string, frameId: string, data: { is_selected?: boolean }): Promise<StoryboardFrame> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/storyboard/${projectId}/frames/${frameId}`,
      {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) throw new Error('Failed to update frame');
    return response.json();
  },

  async deleteFrame(projectId: string, frameId: string): Promise<void> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/storyboard/${projectId}/frames/${frameId}`,
      {
        method: 'DELETE',
        headers: getHeaders(),
      }
    );
    if (!response.ok) throw new Error('Failed to delete frame');
  },

  async generateFrame(projectId: string, shotId: string): Promise<StoryboardFrame> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/storyboard/${projectId}/shots/${shotId}/generate`,
      {
        method: 'POST',
        headers: getHeaders(),
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Generation failed' }));
      throw new Error(errorData.detail || `Generation failed (${response.status})`);
    }
    return response.json();
  },

  async yoloFill(
    projectId: string,
    onEvent: (event: YoloEvent) => void,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes for all phases
    try {
      const response = await fetch(`${API_BASE_URL}/ai/yolo-fill`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ project_id: projectId }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to start YOLO fill');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') return;

          try {
            const data = JSON.parse(payload) as YoloEvent;
            onEvent(data);
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('Request timeout');
      throw error;
    }
  },

  // ============================================================
  // Shows (v4.2 -- Phase 38)
  // ============================================================

  async getShows(): Promise<Show[]> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shows/`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch shows');
    return response.json();
  },

  async getShow(id: string): Promise<Show> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shows/${id}`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch show');
    return response.json();
  },

  async createShow(data: ShowCreate): Promise<Show> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shows/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create show');
    return response.json();
  },

  async updateShow(id: string, data: Partial<ShowCreate>): Promise<Show> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shows/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update show');
    return response.json();
  },

  async deleteShow(id: string): Promise<void> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shows/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete show');
  },

  async getBible(showId: string): Promise<BibleResponse> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shows/${showId}/bible`, { headers: getHeaders() });
    if (!response.ok) throw new Error('Failed to fetch bible');
    return response.json();
  },

  async updateBible(showId: string, data: Partial<BibleUpdate>): Promise<BibleResponse> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/shows/${showId}/bible`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update bible');
    return response.json();
  },

  async getEpisodes(showId: string): Promise<Project[]> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/shows/${showId}/episodes`,
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to fetch episodes');
    return response.json();
  },

  async createEpisode(showId: string, data: { title: string; framework?: string }): Promise<Project> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/shows/${showId}/episodes`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) throw new Error('Failed to create episode');
    return response.json();
  },

  // ============================================================
  // API Keys (v5.0 -- Phase 43)
  // ============================================================

  async createApiKey(data: ApiKeyCreate): Promise<ApiKeyCreateResponse> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/auth/api-keys`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create API key');
    return response.json();
  },

  async listApiKeys(): Promise<ApiKey[]> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/auth/api-keys`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to list API keys');
    return response.json();
  },

  async revokeApiKey(keyId: string): Promise<void> {
    const response = await fetchWithTimeout(`${API_BASE_URL}/auth/api-keys/${keyId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to revoke API key');
  },

  // ============================================================
  // Snapshots (Phase 48)
  // ============================================================

  async listSnapshots(projectId: string, page = 1, perPage = 20): Promise<SnapshotListResponse> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/projects/${projectId}/snapshots?page=${page}&per_page=${perPage}`,
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to list snapshots');
    return response.json();
  },

  async getSnapshot(projectId: string, snapshotId: string): Promise<SnapshotDetail> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/projects/${projectId}/snapshots/${snapshotId}`,
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to get snapshot');
    return response.json();
  },

  async createSnapshot(projectId: string, label?: string): Promise<Snapshot> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/projects/${projectId}/snapshots`,
      { method: 'POST', headers: getHeaders(), body: JSON.stringify({ label: label || null }) }
    );
    if (!response.ok) throw new Error('Failed to create snapshot');
    return response.json();
  },

  async restoreSnapshot(projectId: string, snapshotId: string, phaseIds?: string[]): Promise<RestoreResponse> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/projects/${projectId}/snapshots/${snapshotId}/restore`,
      { method: 'POST', headers: getHeaders(), body: JSON.stringify(phaseIds ? { phase_ids: phaseIds } : {}) }
    );
    if (!response.ok) throw new Error('Failed to restore snapshot');
    return response.json();
  },

  async deleteSnapshot(projectId: string, snapshotId: string): Promise<void> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/projects/${projectId}/snapshots/${snapshotId}`,
      { method: 'DELETE', headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to delete snapshot');
  },

  // ============================================================
  // Comparison / Remove Screenplay (Phase 49)
  // ============================================================

  async getCurrentState(projectId: string): Promise<SnapshotData> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/projects/${projectId}/snapshots/current-state`,
      { headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to get current state');
    return response.json();
  },

  async removeScreenplay(projectId: string): Promise<RemoveScreenplayResponse> {
    const response = await fetchWithTimeout(
      `${API_BASE_URL}/projects/${projectId}/snapshots/remove-screenplay`,
      { method: 'POST', headers: getHeaders() }
    );
    if (!response.ok) throw new Error('Failed to remove screenplay');
    return response.json();
  },
};