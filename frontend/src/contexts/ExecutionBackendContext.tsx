/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { apiClient } from '../lib/apiClient';

type ExecutionBackend = 'comfyui' | 'runpod';

interface ExecutionBackendContextType {
  backend: ExecutionBackend;
  setBackend: (backend: ExecutionBackend) => void;
  isRunPodEnabled: boolean;
  isRunPodConfigured: boolean;
  loading: boolean;
}

const ExecutionBackendContext = createContext<ExecutionBackendContextType | undefined>(undefined);

export function ExecutionBackendProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [backend, setBackendState] = useState<ExecutionBackend>('comfyui');
  const [isRunPodEnabled, setIsRunPodEnabled] = useState(false);
  const [isRunPodConfigured, setIsRunPodConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check RunPod availability on mount
  useEffect(() => {
    async function checkRunPodHealth() {
      try {
        const response: any = await apiClient.getRunPodHealth();
        setIsRunPodEnabled(response.enabled);
        setIsRunPodConfigured(response.configured);
      } catch (error) {
        console.error('Failed to check RunPod health:', error);
        setIsRunPodEnabled(false);
        setIsRunPodConfigured(false);
      } finally {
        setLoading(false);
      }
    }

    checkRunPodHealth();
  }, []);

  // Load user preference on mount and when user changes
  useEffect(() => {
    if (!isAuthenticated || !user) {
      // Not logged in - use localStorage fallback
      const savedBackend = localStorage.getItem('vapai-execution-backend') as ExecutionBackend;
      if (savedBackend === 'runpod' || savedBackend === 'comfyui') {
        setBackendState(savedBackend);
      }
      return;
    }

    // Logged in - try to get from user metadata, fallback to localStorage
    const userMetadata = (user as any).user_metadata || {};
    const preferredBackend = userMetadata.preferred_execution_backend as ExecutionBackend;

    if (preferredBackend === 'runpod' || preferredBackend === 'comfyui') {
      setBackendState(preferredBackend);
      // Sync to localStorage
      localStorage.setItem('vapai-execution-backend', preferredBackend);
    } else {
      // No user preference, check localStorage
      const savedBackend = localStorage.getItem('vapai-execution-backend') as ExecutionBackend;
      if (savedBackend) {
        setBackendState(savedBackend);
      }
    }
  }, [user, isAuthenticated]);

  const setBackend = async (newBackend: ExecutionBackend) => {
    setBackendState(newBackend);

    // Always update localStorage (works for logged in and guest users)
    localStorage.setItem('vapai-execution-backend', newBackend);

    // If logged in, also update user metadata
    if (isAuthenticated && user) {
      try {
        await apiClient.updateUserMetadata({
          preferred_execution_backend: newBackend
        });
      } catch (error) {
        console.error('Failed to update user metadata:', error);
        // Non-blocking error - localStorage update succeeded
      }
    }
  };

  return (
    <ExecutionBackendContext.Provider value={{
      backend,
      setBackend,
      isRunPodEnabled,
      isRunPodConfigured,
      loading
    }}>
      {children}
    </ExecutionBackendContext.Provider>
  );
}

export function useExecutionBackend() {
  const context = useContext(ExecutionBackendContext);
  if (!context) {
    throw new Error('useExecutionBackend must be used within ExecutionBackendProvider');
  }
  return context;
}
