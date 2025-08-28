
interface Props {
  onNavigate: (page: "multitalk-one" | "multitalk-multiple" | "video-lipsync" | "image-edit" | "character-caption") => void;
}

export default function Homepage({ onNavigate }: Props) {
  const apps = [
    {
      id: "multitalk-one" as const,
      title: "Lipsync 1 Person",
      description: "Generate realistic talking videos from a single person image with custom audio and voice.",
      icon: "👤",
      gradient: "from-blue-500 to-purple-600",
      features: ["Single person avatar", "Custom voice synthesis", "Lip-sync generation"]
    },
    {
      id: "multitalk-multiple" as const,
      title: "Lipsync Multi Person",
      description: "Create conversations between multiple people with synchronized audio and video.",
      icon: "🎵",
      gradient: "from-emerald-500 to-teal-600",
      features: ["Multiple avatars", "Multi-audio sync", "Conversation flow"]
    },
    {
      id: "video-lipsync" as const,
      title: "Video Lipsync",
      description: "Add perfect lip-synchronization to existing videos with new audio tracks.",
      icon: "🎬",
      gradient: "from-green-500 to-blue-600",
      features: ["Video upload", "Audio replacement", "Precision lip-sync"]
    },
    {
      id: "image-edit" as const,
      title: "Image Edit",
      description: "Edit and enhance images using AI-powered editing with natural language instructions.",
      icon: "✨",
      gradient: "from-purple-500 to-pink-600",
      features: ["AI image editing", "Natural language prompts", "16:9 output format"]
    },
    {
      id: "character-caption" as const,
      title: "Character Caption",
      description: "Generate detailed captions for character images to create training datasets for LoRA models.",
      icon: "📝",
      gradient: "from-indigo-500 to-purple-600",
      features: ["AI caption generation", "Batch processing", "LoRA training datasets"]
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="text-center space-y-6 mb-16">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 rounded-3xl flex items-center justify-center shadow-2xl">
              <span className="text-white font-bold text-2xl">🎬</span>
            </div>
          </div>
          <h1 className="text-5xl md:text-7xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
            VAPAI Studio
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            Your complete AI-powered media creation suite. Generate talking videos, sync audio, and edit images with cutting-edge technology.
          </p>
          <div className="flex items-center justify-center gap-6 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span>AI-Powered</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
              <span>Real-time Processing</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
              <span>Professional Quality</span>
            </div>
          </div>
        </div>

        {/* Apps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-8 mb-16">
          {apps.map((app) => (
            <div
              key={app.id}
              onClick={() => onNavigate(app.id)}
              className="group relative p-8 rounded-3xl bg-white/80 backdrop-blur-sm border border-gray-200/50 shadow-lg hover:shadow-2xl transform hover:scale-[1.02] transition-all duration-300 cursor-pointer overflow-hidden"
            >
              {/* Background Gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${app.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`}></div>
              
              {/* Content */}
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-14 h-14 bg-gradient-to-br ${app.gradient} rounded-2xl flex items-center justify-center text-2xl shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                    {app.icon}
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                      <span className="text-gray-600">→</span>
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-900 mb-3 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-blue-600 group-hover:to-purple-600 transition-all duration-300">
                  {app.title}
                </h3>
                
                <p className="text-gray-600 mb-6 leading-relaxed">
                  {app.description}
                </p>

                <div className="space-y-2">
                  {app.features.map((feature, index) => (
                    <div key={index} className="flex items-center gap-3 text-sm">
                      <div className={`w-1.5 h-1.5 bg-gradient-to-r ${app.gradient} rounded-full`}></div>
                      <span className="text-gray-600">{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100">
                  <div className={`inline-flex items-center gap-2 text-sm font-medium bg-gradient-to-r ${app.gradient} bg-clip-text text-transparent`}>
                    <span>Launch App</span>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">→</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer Info */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-4 px-6 py-3 rounded-2xl bg-white/60 backdrop-blur-sm border border-gray-200/50">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>
              <span>Powered by ComfyUI & OpenRouter</span>
            </div>
            <div className="w-px h-4 bg-gray-300"></div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>🚀</span>
              <span>Next-gen AI Media Suite</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 max-w-2xl mx-auto">
            Configure your API keys in the navigation bar to get started. All processing happens in real-time with professional-grade AI models.
          </p>
        </div>
      </div>
    </div>
  );
}