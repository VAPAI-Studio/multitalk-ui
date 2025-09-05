import { useState, useEffect } from "react";
import Homepage from "./Homepage";
import MultiTalkOnePerson from "./MultiTalkOnePerson";
import MultiTalkMultiplePeople from "./MultiTalkMultiplePeople";
import VideoLipsync from "./VideoLipsync";
import ImageEdit from "./ImageEdit";
import GenerationFeed from "./GenerationFeed";
import CharacterCaption from "./CharacterCaption";
import WANI2V from "./WANI2V";
import StyleTransfer from "./StyleTransfer";
import ComfyUIStatus from "./components/ComfyUIStatus";
import ConsoleToggle from "./components/ConsoleToggle";

export default function App() {
  const [currentPage, setCurrentPage] = useState<"home" | "multitalk-one" | "multitalk-multiple" | "video-lipsync" | "image-edit" | "generation-feed" | "character-caption" | "wan-i2v" | "style-transfer">("home");
  const [comfyUrl, setComfyUrl] = useState<string>("https://comfy.vapai.studio");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // Load saved page and ComfyUI URL from localStorage on mount
  useEffect(() => {
    const savedPage = localStorage.getItem('vapai-current-page') as typeof currentPage;
    const savedComfyUrl = localStorage.getItem('vapai-comfy-url');
    
    if (savedPage && ['home', 'multitalk-one', 'multitalk-multiple', 'video-lipsync', 'image-edit', 'generation-feed', 'character-caption', 'wan-i2v', 'style-transfer'].includes(savedPage)) {
      setCurrentPage(savedPage);
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
                  <span className="text-xl font-black bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent group-hover:from-purple-600 group-hover:to-pink-600 transition-all duration-200">VAPAI Studio</span>
                </button>
              </div>
            </div>
            
            {/* Right: ComfyUI Settings */}
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
            <div className="flex-1 p-6 space-y-2">
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
                onClick={() => handlePageChange("multitalk-one")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "multitalk-one"
                    ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">👤</span>
                <span className="font-medium">Lipsync 1 Person</span>
              </button>
              <button
                onClick={() => handlePageChange("multitalk-multiple")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "multitalk-multiple"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🎵</span>
                <span className="font-medium">Lipsync Multi Person</span>
              </button>
              <button
                onClick={() => handlePageChange("video-lipsync")}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
                  currentPage === "video-lipsync"
                    ? "bg-gradient-to-r from-green-500 to-blue-600 text-white shadow-lg"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="text-lg">🎬</span>
                <span className="font-medium">Video Lipsync</span>
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
          {currentPage === "multitalk-one" && (
            <div className="w-full max-w-6xl mx-auto p-6">
              <MultiTalkOnePerson comfyUrl={comfyUrl} />
            </div>
          )}
          {currentPage === "multitalk-multiple" && (
            <div className="w-full max-w-6xl mx-auto p-6">
              <MultiTalkMultiplePeople comfyUrl={comfyUrl} />
            </div>
          )}
          {currentPage === "video-lipsync" && (
            <div className="w-full max-w-6xl mx-auto p-6">
              <VideoLipsync comfyUrl={comfyUrl} />
            </div>
          )}
          {currentPage === "image-edit" && (
            <div className="w-full max-w-6xl mx-auto p-6">
              <ImageEdit />
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
          {currentPage === "style-transfer" && (
            <StyleTransfer comfyUrl={comfyUrl} />
          )}
        </main>
      </div>
      
      {/* Console Toggle */}
      <ConsoleToggle comfyUrl={comfyUrl} />
    </div>
  );
}
