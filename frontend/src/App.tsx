import { useState, useEffect } from "react";
// Page components
import Homepage from "./pages/Homepage";
import GenerationFeed from "./pages/GenerationFeed";
import ProfileSettings from "./ProfileSettings";
import StudioPage from "./components/StudioPage";
// UI Components
import ComfyUIStatus from "./components/ComfyUIStatus";
import ConsoleToggle from "./components/ConsoleToggle";
import AuthPage from "./components/AuthPage";
import ThemeToggle from "./components/ThemeToggle";
import ProjectSelector from "./components/ProjectSelector";
// Contexts & Config
import { useAuth } from "./contexts/AuthContext";
import { ProjectProvider } from "./contexts/ProjectContext";
import { studios, getStudioById, setLastUsedApp, type StudioPageType, type StudioConfig } from "./lib/studioConfig";

// Collapsible Sidebar Group Component
function SidebarGroup({
  studio,
  currentPage,
  isExpanded,
  onToggleExpand,
  onNavigate,
}: {
  studio: StudioConfig;
  currentPage: StudioPageType;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onNavigate: (page: StudioPageType) => void;
}) {
  const isActive = currentPage === studio.id;
  const hasMultipleApps = studio.apps.length > 1;
  const isDisabled = studio.comingSoon;

  return (
    <div>
      {/* Group Header */}
      <button
        onClick={() => {
          if (isDisabled) return;
          if (hasMultipleApps) {
            onToggleExpand();
          } else {
            onNavigate(studio.id as StudioPageType);
          }
        }}
        disabled={isDisabled}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 ${
          isActive
            ? `bg-gradient-to-r ${studio.gradient} text-white shadow-lg`
            : isDisabled
              ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
              : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{studio.icon}</span>
          <span className="font-medium">{studio.title}</span>
          {isDisabled && (
            <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded-full">Soon</span>
          )}
        </div>
        {hasMultipleApps && !isDisabled && (
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Collapsible Sub-items */}
      {isExpanded && hasMultipleApps && !isDisabled && (
        <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-200 dark:border-gray-700 pl-4">
          {studio.apps.map((app) => (
            <button
              key={app.id}
              onClick={() => {
                // Set last used app and navigate to studio
                setLastUsedApp(studio.id, app.id);
                onNavigate(studio.id as StudioPageType);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-all duration-200"
            >
              <span>{app.icon}</span>
              <span>{app.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { isAuthenticated, loading, user, logout } = useAuth();
  const [currentPage, setCurrentPage] = useState<StudioPageType>("home");
  const [comfyUrl, setComfyUrl] = useState<string>("https://comfy.vapai.studio");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false);
  const [expandedStudio, setExpandedStudio] = useState<string | null>(null);

  // Valid page values for localStorage validation
  const validPages: StudioPageType[] = [
    'home',
    'lipsync-studio',
    'image-studio',
    'video-studio',
    'audio-studio',
    'text-studio',
    'lora-studio',
    'history',
    'profile-settings'
  ];

  // Load saved page and ComfyUI URL from localStorage on mount
  useEffect(() => {
    const savedPage = localStorage.getItem('vapai-current-page') as StudioPageType;
    const savedComfyUrl = localStorage.getItem('vapai-comfy-url');

    if (savedPage && validPages.includes(savedPage)) {
      setCurrentPage(savedPage);
    }

    // Migrate old page names to new studio pages
    const oldToNew: Record<string, StudioPageType> = {
      'multitalk-one': 'lipsync-studio',
      'multitalk-multiple': 'lipsync-studio',
      'video-lipsync': 'lipsync-studio',
      'lipsync': 'lipsync-studio',
      'image-edit': 'image-studio',
      'style-transfer': 'image-studio',
      'create-image': 'image-studio',
      'image-grid': 'image-studio',
      'wan-i2v': 'video-studio',
      'wan-move': 'video-studio',
      'ltx2-i2v': 'video-studio',
      'audio-stem-separator': 'audio-studio',
      'character-caption': 'lora-studio',
      'lora-trainer': 'lora-studio',
      'generation-feed': 'history',
    };

    if (savedPage && oldToNew[savedPage]) {
      const newPage = oldToNew[savedPage];
      setCurrentPage(newPage);
      localStorage.setItem('vapai-current-page', newPage);
    }

    if (savedComfyUrl) {
      setComfyUrl(savedComfyUrl);
    }
  }, []);

  // Save current page to localStorage when it changes
  const handlePageChange = (page: StudioPageType) => {
    setCurrentPage(page);
    localStorage.setItem('vapai-current-page', page);
    setSidebarOpen(false);
  };

  // Save ComfyUI URL to localStorage when it changes
  const handleComfyUrlChange = (url: string) => {
    setComfyUrl(url);
    localStorage.setItem('vapai-comfy-url', url);
  };

  // Toggle studio expansion
  const toggleStudioExpansion = (studioId: string) => {
    setExpandedStudio(expandedStudio === studioId ? null : studioId);
  };

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg mx-auto mb-4 animate-pulse">
            <span className="text-white font-bold text-3xl">🎬</span>
          </div>
          <p className="text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    );
  }

  // Show auth page if not authenticated
  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return (
    <ProjectProvider>
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white/70 dark:bg-gray-900/60 backdrop-blur-lg border-b border-gray-200/50 dark:border-gray-700/50 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Left: Menu + Title */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 bg-white/90 dark:bg-gray-900/90 backdrop-blur-lg rounded-xl shadow border border-gray-200/50 dark:border-gray-700/50 hover:scale-105 transition-all duration-200"
              >
                <span className="text-gray-700 dark:text-gray-300">☰</span>
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handlePageChange("home")}
                  className="flex items-center gap-3 hover:scale-105 transition-all duration-200 group"
                >
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg group-hover:shadow-xl group-hover:rotate-3 transition-all duration-200">
                    <span className="text-white font-bold text-lg">🎬</span>
                  </div>
                  <span className="text-xl font-black bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent group-hover:from-purple-600 group-hover:to-pink-600 transition-all duration-200">sideOUTsticks</span>
                </button>
              </div>
            </div>

            {/* Right: ComfyUI Settings + User Menu */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">ComfyUI</label>
                <input
                  type="text"
                  className="rounded-xl border-2 border-gray-200 dark:border-dark-border-primary px-3 py-2 text-gray-800 dark:text-dark-text-primary placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50 transition-all duration-200 bg-white/90 dark:bg-dark-surface-primary w-56 text-sm"
                  placeholder="https://comfy.vapai.studio"
                  value={comfyUrl}
                  onChange={(e) => handleComfyUrlChange(e.target.value)}
                />
              </div>
              <ComfyUIStatus baseUrl={comfyUrl} />

              {/* Project Selector */}
              <ProjectSelector />

              {/* User Menu */}
              <div className="relative flex items-center gap-3 pl-3 border-l border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
                >
                  {user?.profile_picture_url ? (
                    <img
                      src={user.profile_picture_url}
                      alt="Profile"
                      className="w-8 h-8 rounded-full object-cover border-2 border-gray-200"
                    />
                  ) : (
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-sm font-bold">
                        {(user?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{user?.full_name || user?.email}</p>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {userMenuOpen && (
                  <>
                    {/* Backdrop */}
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setUserMenuOpen(false)}
                    />

                    {/* Dropdown */}
                    <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-dark-surface-primary rounded-xl shadow-xl border border-gray-200 dark:border-dark-border-primary py-2 z-40">
                      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                        <p className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">{user?.full_name || 'User'}</p>
                        <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">{user?.email}</p>
                      </div>

                      {/* Theme Toggle */}
                      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Theme</p>
                        <ThemeToggle />
                      </div>

                      {/* Profile Settings */}
                      <button
                        onClick={() => {
                          setCurrentPage("profile-settings");
                          setUserMenuOpen(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Editar Perfil
                      </button>

                      {/* Dev-only: Clear session */}
                      {import.meta.env.DEV && (
                        <button
                          onClick={() => {
                            localStorage.clear();
                            window.location.reload();
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-colors flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Clear Session (Dev)
                        </button>
                      )}

                      <button
                        onClick={() => {
                          logout();
                          setUserMenuOpen(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Logout
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <div className={`fixed inset-y-0 left-0 z-50 flex transition-all duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}>
          <div className="flex flex-col w-80 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border-r border-gray-200/50 dark:border-gray-700/50 shadow-2xl">
            {/* Sidebar Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200/50 dark:border-gray-700/50">
              <span className="text-lg font-bold text-gray-800 dark:text-gray-200">Navigation</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="text-gray-500 dark:text-gray-400">✕</span>
              </button>
            </div>

            {/* Navigation Items */}
            <div className="flex-1 p-6 space-y-2 overflow-y-auto">
              {/* Home */}
              <button
                onClick={() => handlePageChange("home")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "home"
                    ? "bg-gradient-to-r from-gray-600 to-gray-800 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🏠</span>
                <span className="font-medium">Home</span>
              </button>

              {/* Studio Groups */}
              <div className="mt-4 pt-4 border-t border-gray-200/50 dark:border-gray-700/50">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 mb-3 block">Studios</span>
                {studios.map((studio) => (
                  <SidebarGroup
                    key={studio.id}
                    studio={studio}
                    currentPage={currentPage}
                    isExpanded={expandedStudio === studio.id}
                    onToggleExpand={() => toggleStudioExpansion(studio.id)}
                    onNavigate={handlePageChange}
                  />
                ))}
              </div>

              {/* Standalone Pages */}
              <div className="mt-4 pt-4 border-t border-gray-200/50 dark:border-gray-700/50">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 mb-3 block">Tools</span>
                <button
                  onClick={() => handlePageChange("history")}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                    currentPage === "history"
                      ? "bg-gradient-to-r from-gray-600 to-slate-700 text-white shadow-lg"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  <span className="text-lg">📋</span>
                  <span className="font-medium">History</span>
                </button>
              </div>

              {/* External Tools Section */}
              <div className="mt-6 pt-4 border-t border-gray-200/50">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 mb-3 block">External Tools</span>
                <button
                  onClick={() => window.open('https://comfy.vapai.studio', '_blank')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <span className="text-lg">🔧</span>
                  <div className="flex flex-col">
                    <span className="font-medium">ComfyUI</span>
                    <span className="text-xs text-gray-500">Workflow Editor</span>
                  </div>
                  <span className="text-xs text-gray-400 ml-auto">↗</span>
                </button>
                <button
                  onClick={() => window.open('https://notebook.vapai.studio', '_blank')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <span className="text-lg">📓</span>
                  <div className="flex flex-col">
                    <span className="font-medium">Jupyter</span>
                    <span className="text-xs text-gray-500">Notebook</span>
                  </div>
                  <span className="text-xs text-gray-400 ml-auto">↗</span>
                </button>
                <button
                  onClick={() => window.open('https://n8n.vapai.studio', '_blank')}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <span className="text-lg">⚡</span>
                  <div className="flex flex-col">
                    <span className="font-medium">n8n</span>
                    <span className="text-xs text-gray-500">Automation</span>
                  </div>
                  <span className="text-xs text-gray-400 ml-auto">↗</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Page Content */}
        <main className="flex-1 transition-all duration-300">
          {currentPage === "home" && (
            <Homepage
              onNavigate={(page) => handlePageChange(page)}
              user={user}
            />
          )}

          {/* Studio Pages */}
          {currentPage === "lipsync-studio" && (
            <StudioPage
              studio={getStudioById("lipsync-studio")!}
              comfyUrl={comfyUrl}
            />
          )}
          {currentPage === "image-studio" && (
            <StudioPage
              studio={getStudioById("image-studio")!}
              comfyUrl={comfyUrl}
            />
          )}
          {currentPage === "video-studio" && (
            <StudioPage
              studio={getStudioById("video-studio")!}
              comfyUrl={comfyUrl}
            />
          )}
          {currentPage === "audio-studio" && (
            <StudioPage
              studio={getStudioById("audio-studio")!}
              comfyUrl={comfyUrl}
            />
          )}
          {currentPage === "text-studio" && (
            <StudioPage
              studio={getStudioById("text-studio")!}
              comfyUrl={comfyUrl}
            />
          )}
          {currentPage === "lora-studio" && (
            <StudioPage
              studio={getStudioById("lora-studio")!}
              comfyUrl={comfyUrl}
            />
          )}

          {/* Standalone Pages */}
          {currentPage === "history" && (
            <GenerationFeed />
          )}
          {currentPage === "profile-settings" && (
            <ProfileSettings onNavigateBack={() => setCurrentPage("home")} />
          )}
        </main>
      </div>

      {/* Console Toggle */}
      <ConsoleToggle comfyUrl={comfyUrl} />
    </div>
    </ProjectProvider>
  );
}
