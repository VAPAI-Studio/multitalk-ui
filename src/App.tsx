import { useState } from "react";
import MultiTalkOnePerson from "./MultiTalkOnePerson";
import MultiTalkMultiplePeople from "./MultiTalkMultiplePeople";
import VideoLipsync from "./VideoLipsync";
import ComfyUIStatus from "./components/ComfyUIStatus";

export default function App() {
  const [currentPage, setCurrentPage] = useState<"multitalk-one" | "multitalk-multiple" | "video-lipsync">("multitalk-one");
  const [comfyUrl, setComfyUrl] = useState<string>("https://comfy.vapai.studio");

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation */}
      <nav className="bg-white/70 dark:bg-gray-900/60 backdrop-blur-lg border-b border-gray-200/50 dark:border-gray-700/50 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-lg">🎬</span>
              </div>
              <span className="text-xl font-black bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">MultiTalk Studio</span>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">URL de ComfyUI</label>
                <input
                  type="text"
                  className="rounded-xl border-2 border-gray-200 px-3 py-2 text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200 bg-white/90 w-80"
                  placeholder="https://comfy.vapai.studio"
                  value={comfyUrl}
                  onChange={(e) => setComfyUrl(e.target.value)}
                />
              </div>
              <ComfyUIStatus baseUrl={comfyUrl} />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setCurrentPage("multitalk-one")}
                className={`px-5 py-3 rounded-2xl font-bold transition-all duration-300 text-sm ${
                  currentPage === "multitalk-one"
                    ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg transform scale-105"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 hover:scale-105"
                }`}
              >
                👤 1 Persona
              </button>
              <button
                onClick={() => setCurrentPage("multitalk-multiple")}
                className={`px-5 py-3 rounded-2xl font-bold transition-all duration-300 text-sm ${
                  currentPage === "multitalk-multiple"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg transform scale-105"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 hover:scale-105"
                }`}
              >
                🎵 MultiAudio
              </button>
              <button
                onClick={() => setCurrentPage("video-lipsync")}
                className={`px-5 py-3 rounded-2xl font-bold transition-all duration-300 text-sm ${
                  currentPage === "video-lipsync"
                    ? "bg-gradient-to-r from-green-500 to-blue-600 text-white shadow-lg transform scale-105"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 hover:scale-105"
                }`}
              >
                🎬 Video Lipsync
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Page Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto p-6">
        {currentPage === "multitalk-one" && <MultiTalkOnePerson comfyUrl={comfyUrl} />}
        {currentPage === "multitalk-multiple" && <MultiTalkMultiplePeople comfyUrl={comfyUrl} />}
        {currentPage === "video-lipsync" && <VideoLipsync comfyUrl={comfyUrl} />}
      </main>
    </div>
  );
}
