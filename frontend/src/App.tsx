import { useState, useEffect } from "react";
// Page components (moved to pages/ folder)
import Homepage from "./pages/Homepage";
import Lipsync from "./pages/Lipsync";
import ImageEdit from "./pages/ImageEdit";
import GenerationFeed from "./pages/GenerationFeed";
import CharacterCaption from "./pages/CharacterCaption";
import WANI2V from "./pages/WANI2V";
import WANMove from "./pages/WANMove";
import StyleTransfer from "./pages/StyleTransfer";
import CreateImage from "./pages/CreateImage";
import LoRATrainer from "./pages/LoraTrainer";
import ImageGrid from "./pages/ImageGrid";
import AudioStemSeparator from "./pages/AudioStemSeparator";
import LTX2I2V from "./pages/LTX2I2V";
// import Img2Img from "./pages/Img2Img"; // Hidden: Image to Image page
import ComfyUIStatus from "./components/ComfyUIStatus";
import ConsoleToggle from "./components/ConsoleToggle";
import AuthPage from "./components/AuthPage";
import { useAuth } from "./contexts/AuthContext";

export default function App() {
  const { isAuthenticated, loading, user, logout } = useAuth();
  const [currentPage, setCurrentPage] = useState<"home" | "lipsync" | "image-edit" | "generation-feed" | "character-caption" | "wan-i2v" | "wan-move" | "style-transfer" | "create-image" | "lora-trainer" | "image-grid" | "audio-stem-separator" | "ltx2-i2v" | "img2img">("home");
  const [comfyUrl, setComfyUrl] = useState<string>("https://comfy.vapai.studio");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false);

  // Load saved page and ComfyUI URL from localStorage on mount
  useEffect(() => {
    const savedPage = localStorage.getItem('vapai-current-page') as typeof currentPage;
    const savedComfyUrl = localStorage.getItem('vapai-comfy-url');
    
    if (savedPage && ['home', 'lipsync', 'image-edit', 'generation-feed', 'character-caption', 'wan-i2v', 'wan-move', 'style-transfer', 'create-image', 'lora-trainer', 'image-grid', 'audio-stem-separator', 'ltx2-i2v', 'img2img'].includes(savedPage)) {
      setCurrentPage(savedPage);
    }
    // Migrate old page names to new unified lipsync page
    if (savedPage && ['multitalk-one', 'multitalk-multiple', 'video-lipsync'].includes(savedPage)) {
      setCurrentPage('lipsync');
      localStorage.setItem('vapai-current-page', 'lipsync');
    }
    
    if (savedComfyUrl) {
      setComfyUrl(savedComfyUrl);
    }
  }, []);

  // Save current page to localStorage when it changes
  const handlePageChange = (page: typeof currentPage) => {
    setCurrentPage(page);
    localStorage.setItem('vapai-current-page', page);
    setSidebarOpen(false);
  };

  // Save ComfyUI URL to localStorage when it changes
  const handleComfyUrlChange = (url: string) => {
    setComfyUrl(url);
    localStorage.setItem('vapai-comfy-url', url);
  };

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg mx-auto mb-4 animate-pulse">
            <span className="text-white font-bold text-3xl">🎬</span>
          </div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show auth page if not authenticated
  if (!isAuthenticated) {
    return <AuthPage />;
  }

  return (
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
                <label className="text-xs font-medium text-gray-700">ComfyUI</label>
                <input
                  type="text"
                  className="rounded-xl border-2 border-gray-200 px-3 py-2 text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200 bg-white/90 w-56 text-sm"
                  placeholder="https://comfy.vapai.studio"
                  value={comfyUrl}
                  onChange={(e) => handleComfyUrlChange(e.target.value)}
                />
              </div>
              <ComfyUIStatus baseUrl={comfyUrl} />

              {/* User Menu */}
              <div className="relative flex items-center gap-3 pl-3 border-l border-gray-200">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-gray-100 transition-all duration-200"
                >
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">
                      {(user?.full_name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
                    </span>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-700">{user?.full_name || user?.email}</p>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-500 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
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
                    <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-40">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm font-medium text-gray-900">{user?.full_name || 'User'}</p>
                        <p className="text-xs text-gray-500">{user?.email}</p>
                      </div>

                      {/* Dev-only: Clear session */}
                      {import.meta.env.DEV && (
                        <button
                          onClick={() => {
                            localStorage.clear();
                            window.location.reload();
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-yellow-700 hover:bg-yellow-50 transition-colors flex items-center gap-2"
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
                        className="w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-red-50 transition-colors flex items-center gap-2"
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
            <div className="flex items-center justify-between p-6 border-b border-gray-200/50">
              <span className="text-lg font-bold text-gray-800 dark:text-gray-200">Navigation</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="text-gray-500">✕</span>
              </button>
            </div>

            {/* Navigation Items */}
            <div className="flex-1 p-6 space-y-2 overflow-y-auto">
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
              <button
                onClick={() => handlePageChange("lipsync")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "lipsync"
                    ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🎤</span>
                <span className="font-medium">Lipsync Studio</span>
              </button>
              <button
                onClick={() => handlePageChange("image-edit")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "image-edit"
                    ? "bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🎨</span>
                <span className="font-medium">Image Edit</span>
              </button>
              <button
                onClick={() => handlePageChange("character-caption")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "character-caption"
                    ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">📝</span>
                <span className="font-medium">Character Caption</span>
              </button>
              <button
                onClick={() => handlePageChange("wan-i2v")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "wan-i2v"
                    ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🎬</span>
                <span className="font-medium">WAN I2V</span>
              </button>
              <button
                onClick={() => handlePageChange("wan-move")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "wan-move"
                    ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🎯</span>
                <span className="font-medium">WAN Move</span>
              </button>
              <button
                onClick={() => handlePageChange("ltx2-i2v")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "ltx2-i2v"
                    ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🎥</span>
                <span className="font-medium">LTX2 I2V</span>
              </button>
              <button
                onClick={() => handlePageChange("style-transfer")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "style-transfer"
                    ? "bg-gradient-to-r from-orange-500 to-red-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🎨</span>
                <span className="font-medium">Style Transfer</span>
              </button>
              <button
                onClick={() => handlePageChange("create-image")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "create-image"
                    ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">✨</span>
                <span className="font-medium">Create Image</span>
              </button>
              <button
                onClick={() => handlePageChange("lora-trainer")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "lora-trainer"
                    ? "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🧠</span>
                <span className="font-medium">LoRA Trainer</span>
              </button>
              <button
                onClick={() => handlePageChange("image-grid")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "image-grid"
                    ? "bg-gradient-to-r from-teal-500 to-cyan-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🖼️</span>
                <span className="font-medium">Image Grid</span>
              </button>
              <button
                onClick={() => handlePageChange("audio-stem-separator")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "audio-stem-separator"
                    ? "bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🎵</span>
                <span className="font-medium">Audio Stem Separator</span>
              </button>
              <button
                onClick={() => handlePageChange("generation-feed")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "generation-feed"
                    ? "bg-gradient-to-r from-pink-500 to-rose-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🖼️</span>
                <span className="font-medium">Generation Feed</span>
              </button>
              {/* Hidden: Image to Image page */}
              {/* <button
                onClick={() => handlePageChange("img2img")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "img2img"
                    ? "bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🖼️</span>
                <span className="font-medium">Image to Image</span>
              </button> */}

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
            <Homepage onNavigate={(page) => handlePageChange(page)} />
          )}
          {currentPage === "lipsync" && (
            <div className="w-full max-w-6xl mx-auto p-6">
              <Lipsync comfyUrl={comfyUrl} />
            </div>
          )}
          {currentPage === "image-edit" && (
            <div className="w-full max-w-6xl mx-auto p-6">
              <ImageEdit comfyUrl={comfyUrl} />
            </div>
          )}
          {currentPage === "generation-feed" && (
            <GenerationFeed />
          )}
          {currentPage === "character-caption" && (
            <div className="w-full max-w-7xl mx-auto p-6">
              <CharacterCaption comfyUrl={comfyUrl} />
            </div>
          )}
          {currentPage === "wan-i2v" && (
            <WANI2V comfyUrl={comfyUrl} />
          )}
          {currentPage === "wan-move" && (
            <WANMove comfyUrl={comfyUrl} />
          )}
          {currentPage === "style-transfer" && (
            <StyleTransfer comfyUrl={comfyUrl} />
          )}
          {currentPage === "create-image" && (
            <CreateImage comfyUrl={comfyUrl} />
          )}
          {currentPage === "lora-trainer" && (
            <LoRATrainer />
          )}
          {currentPage === "image-grid" && (
            <ImageGrid comfyUrl={comfyUrl} />
          )}
          {currentPage === "audio-stem-separator" && (
            <AudioStemSeparator comfyUrl={comfyUrl} />
          )}
          {currentPage === "ltx2-i2v" && (
            <LTX2I2V comfyUrl={comfyUrl} />
          )}
          {/* Hidden: Image to Image page */}
          {/* {currentPage === "img2img" && (
            <Img2Img comfyUrl={comfyUrl} />
          )} */}
        </main>
      </div>
      
      {/* Console Toggle */}
      <ConsoleToggle comfyUrl={comfyUrl} />
    </div>
  );
}
