import { useState, useRef, useEffect } from 'react';
import { useProject } from '../contexts/ProjectContext';

export default function ProjectSelector() {
  const { projects, selectedProject, isLoading, error, sortBy, selectProject, setSortBy, refreshProjects } = useProject();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Proyecto</label>
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-dark-border-primary bg-white/90 dark:bg-dark-surface-primary hover:border-purple-400 dark:hover:border-purple-500 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 dark:focus:ring-purple-900/50 transition-all duration-200 min-w-[160px] text-sm"
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin"></div>
              <span className="text-gray-400">Cargando...</span>
            </div>
          ) : error ? (
            <span className="text-red-500 text-xs truncate">{error}</span>
          ) : selectedProject ? (
            <>
              <span className="text-purple-600 dark:text-purple-400">📁</span>
              <span className="text-gray-800 dark:text-dark-text-primary truncate max-w-[120px]">
                {selectedProject.name}
              </span>
            </>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">Seleccionar...</span>
          )}
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ml-auto ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-dark-surface-primary rounded-xl shadow-xl border border-gray-200 dark:border-dark-border-primary py-1 z-50 max-h-80 overflow-y-auto">
          {/* Header with sort toggle and refresh */}
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
            {/* Sort toggle */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSortBy('name');
                }}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  sortBy === 'name'
                    ? 'bg-white dark:bg-gray-700 text-purple-600 dark:text-purple-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
                title="Ordenar por nombre"
              >
                A-Z
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSortBy('recent');
                }}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  sortBy === 'recent'
                    ? 'bg-white dark:bg-gray-700 text-purple-600 dark:text-purple-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
                title="Ordenar por recientes"
              >
                Recientes
              </button>
            </div>

            {/* Refresh button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                refreshProjects();
              }}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="Actualizar lista"
            >
              <svg
                className={`w-4 h-4 text-gray-500 ${isLoading ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* None option */}
          <button
            onClick={() => {
              selectProject(null);
              setIsOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2 ${
              !selectedProject ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300' : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            <span className="text-gray-400">—</span>
            <span>Sin proyecto</span>
          </button>

          {/* Project list */}
          {projects.length === 0 && !isLoading ? (
            <div className="px-3 py-4 text-center text-gray-400 text-sm">
              No se encontraron carpetas
            </div>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  selectProject(project);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2 ${
                  selectedProject?.id === project.id
                    ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                <span className={selectedProject?.id === project.id ? 'text-purple-500' : 'text-gray-400'}>
                  📁
                </span>
                <span className="truncate">{project.name}</span>
                {selectedProject?.id === project.id && (
                  <svg className="w-4 h-4 text-purple-500 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
