/**
 * ScreenwritingStudio.tsx
 *
 * Top-level container that embeds the full screenwriting assistant inside
 * the multitalk-ui shell. Responsibilities:
 *
 * 1. Auth bridge — syncs multitalk's Supabase JWT into localStorage under
 *    'sw-auth-token' so the screenwriting API client picks it up automatically.
 * 2. React Query — provides its own QueryClient (isolated from multitalk's state).
 * 3. MemoryRouter — all react-router-dom routing stays internal; the browser URL
 *    is unchanged when navigating within the screenwriting studio.
 * 4. Renders the full screenwriting route tree without the screenwriting app's
 *    outer Layout/Header (multitalk provides the shell).
 */

import { useEffect } from 'react';
import './screenwriting.css';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';

// Layout
import { Layout } from './components/Layout/Layout';
// Screenwriting pages
import { ProjectList } from './components/Projects/ProjectList';
import { Editor } from './components/Editor/Editor';
import { BookManager } from './components/Books/BookManager';
import { ProjectWorkspace } from './components/Workspace/ProjectWorkspace';
import { SnippetManager } from './components/Snippets/SnippetManager';
import { BreakdownLayout } from './components/Breakdown/BreakdownLayout';
import { StoryboardView } from './components/Storyboard/StoryboardView';
import { ElementDetailPage } from './components/Breakdown/ElementDetailPage';
import { ShowDetail } from './components/Shows/ShowDetail';

// Isolated QueryClient — screenwriting cache is independent of multitalk's cache
const swQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

// Route wrappers that extract URL params (same pattern as original App.tsx)
function StoryboardViewRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return <StoryboardView projectId={projectId} />;
}

function ElementDetailRoute() {
  const { projectId, elementId } = useParams<{ projectId: string; elementId: string }>();
  if (!projectId || !elementId) return null;
  return <ElementDetailPage projectId={projectId} elementId={elementId} />;
}

function ShowDetailRoute() {
  const { showId } = useParams<{ showId: string }>();
  if (!showId) return null;
  return <ShowDetail showId={showId} />;
}

function ScreenwritingRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/projects" element={<ProjectList />} />
        <Route path="/projects/:projectId" element={<Editor />} />
        <Route path="/projects/:projectId/breakdown/elements/:elementId" element={<ElementDetailRoute />} />
        <Route path="/projects/:projectId/breakdown" element={<BreakdownLayout />} />
        <Route path="/projects/:projectId/storyboard" element={<StoryboardViewRoute />} />
        <Route path="/projects/:projectId/:phase" element={<ProjectWorkspace />} />
        <Route path="/projects/:projectId/:phase/:subsectionKey" element={<ProjectWorkspace />} />
        <Route path="/projects/:projectId/:phase/:subsectionKey/:itemId" element={<ProjectWorkspace />} />
        <Route path="/books" element={<BookManager />} />
        <Route path="/snippets" element={<SnippetManager />} />
        <Route path="/shows/:showId" element={<ShowDetailRoute />} />
      </Routes>
    </Layout>
  );
}

interface ScreenwritingStudioProps {
  onBack?: () => void;
}

export default function ScreenwritingStudio({ onBack }: ScreenwritingStudioProps) {
  const { token } = useAuth();

  // Auth bridge: in dev the screenwriter backend accepts 'mock-token' directly.
  // Phase 4 will unify auth so it verifies Supabase JWTs.
  useEffect(() => {
    if (import.meta.env.DEV) {
      localStorage.setItem('sw-auth-token', 'mock-token');
    } else {
      if (token) {
        localStorage.setItem('sw-auth-token', token);
      } else {
        localStorage.removeItem('sw-auth-token');
      }
    }
  }, [token]);

  // Apply screenwriting CSS variables to <html> so Radix UI portals
  // (dropdowns, dialogs) rendered outside .sw-studio still inherit the theme.
  useEffect(() => {
    document.documentElement.classList.add('sw-active');
    return () => {
      document.documentElement.classList.remove('sw-active');
    };
  }, []);

  return (
    <QueryClientProvider client={swQueryClient}>
      <MemoryRouter>
        <div className="sw-studio relative min-h-screen">
          {onBack && (
            <button
              onClick={onBack}
              style={{
                position: 'fixed',
                top: '1rem',
                left: '1rem',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.4rem 0.75rem',
                background: 'hsl(240 5% 10% / 0.9)',
                backdropFilter: 'blur(8px)',
                borderRadius: '0.625rem',
                border: '1px solid hsl(240 4% 22%)',
                color: 'hsl(0 0% 88%)',
                fontSize: '0.8rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              ← Platform
            </button>
          )}
          <ScreenwritingRoutes />
        </div>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
