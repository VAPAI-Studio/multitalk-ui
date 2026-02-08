/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../lib/apiClient';

interface Project {
  id: string;
  name: string;
}

interface DriveFile {
  id: string;
  name: string;
  is_folder: boolean;
}

interface DriveListResponse {
  success: boolean;
  files?: DriveFile[];
  error?: string;
}

type SortBy = 'name' | 'recent';

interface ProjectContextType {
  projects: Project[];
  selectedProject: Project | null;
  isLoading: boolean;
  error: string | null;
  sortBy: SortBy;
  selectProject: (project: Project | null) => void;
  setSortBy: (sortBy: SortBy) => void;
  refreshProjects: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const STORAGE_KEY = 'selectedProject';
const SORT_STORAGE_KEY = 'projectSortBy';

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortByState] = useState<SortBy>('name');

  // Load selected project and sort preference from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSelectedProject(parsed);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    const storedSort = localStorage.getItem(SORT_STORAGE_KEY);
    if (storedSort === 'name' || storedSort === 'recent') {
      setSortByState(storedSort);
    }
  }, []);

  // Fetch root folders from Google Drive
  const refreshProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Use different orderBy based on sortBy preference
      const orderBy = sortBy === 'recent' ? 'folder,modifiedTime desc' : 'folder,name';
      const response = await apiClient.listGoogleDriveFiles({ pageSize: 100, orderBy }) as DriveListResponse;

      if (response.success && response.files) {
        // Filter only folders and exclude those starting with "_"
        const folders = response.files
          .filter((file) => file.is_folder && !file.name.startsWith('_'))
          .map((file) => ({
            id: file.id,
            name: file.name
          }));

        setProjects(folders);

        // Validate that selected project still exists
        if (selectedProject) {
          const stillExists = folders.some((f: Project) => f.id === selectedProject.id);
          if (!stillExists) {
            setSelectedProject(null);
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      } else {
        setError(response.error || 'Failed to load projects');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to Google Drive';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject, sortBy]);

  // Initial fetch
  useEffect(() => {
    refreshProjects();
  }, []);

  // Refresh when sortBy changes
  useEffect(() => {
    refreshProjects();
  }, [sortBy]);

  // Save to localStorage when selection changes
  const selectProject = useCallback((project: Project | null) => {
    setSelectedProject(project);
    if (project) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Set sort preference and save to localStorage
  const setSortBy = useCallback((newSortBy: SortBy) => {
    setSortByState(newSortBy);
    localStorage.setItem(SORT_STORAGE_KEY, newSortBy);
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        projects,
        selectedProject,
        isLoading,
        error,
        sortBy,
        selectProject,
        setSortBy,
        refreshProjects
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}
