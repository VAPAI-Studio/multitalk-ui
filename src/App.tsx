import { useState } from "react";
import MultiTalkOnePerson from "./MultiTalkOnePerson";
import MultiTalkMultiplePeople from "./MultiTalkMultiplePeople";
import AudioTest from "./AudioTest";

export default function App() {
  const [currentPage, setCurrentPage] = useState<"multitalk-one" | "multitalk-multiple" | "audiotest">("multitalk-one");

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
                onClick={() => setCurrentPage("audiotest")}
                className={`px-5 py-3 rounded-2xl font-bold transition-all duration-300 text-sm ${
                  currentPage === "audiotest"
                    ? "bg-gradient-to-r from-orange-500 to-red-600 text-white shadow-lg transform scale-105"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 hover:scale-105"
                }`}
              >
                🎧 Audio Test
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Page Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto p-6">
        {currentPage === "multitalk-one" && <MultiTalkOnePerson />}
        {currentPage === "multitalk-multiple" && <MultiTalkMultiplePeople />}
        {currentPage === "audiotest" && <AudioTest />}
      </main>
    </div>
  );
}
