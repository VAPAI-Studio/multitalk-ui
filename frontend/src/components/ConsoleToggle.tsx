import { useState } from 'react';
import ComfyUIConsole from './ComfyUIConsole';

interface ConsoleToggleProps {
  comfyUrl: string;
}

export default function ConsoleToggle({ comfyUrl }: ConsoleToggleProps) {
  const [showConsole, setShowConsole] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowConsole(true)}
        className="fixed bottom-6 right-6 w-12 h-12 bg-gray-900/90 backdrop-blur-sm hover:bg-gray-800 text-green-400 rounded-full shadow-lg border border-gray-700/50 transition-all duration-200 hover:scale-105 z-40"
        title="Open ComfyUI Console"
      >
        <div className="flex items-center justify-center">
          <span className="text-lg font-mono">$</span>
        </div>
      </button>
      
      <ComfyUIConsole 
        comfyUrl={comfyUrl}
        isVisible={showConsole}
        onClose={() => setShowConsole(false)}
      />
    </>
  );
}