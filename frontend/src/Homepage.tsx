
interface Props {
  onNavigate: (page: "multitalk-one" | "multitalk-multiple" | "video-lipsync" | "image-edit" | "character-caption" | "wan-i2v" | "style-transfer") => void;
}

export default function Homepage({ onNavigate }: Props) {
  const apps = [
    {
      id: "multitalk-one" as const,
      title: "Lipsync 1 Person",
      description: "Generate realistic talking videos from a single person image with custom audio.",
      icon: "👤",
      gradient: "from-blue-500 to-purple-600",
      features: ["Single person avatar", "Model: Multitalk and Infinite Talk with WAN 2.1"]
    },
    {
      id: "multitalk-multiple" as const,
      title: "Lipsync Multi Person",
      description: "Create conversations between multiple people with synchronized audio and video.",
      icon: "🎵",
      gradient: "from-emerald-500 to-teal-600",
      features: ["Multiple avatars", "Masked characters", "Model: Multitalk and Infinite Talk with WAN 2.1"]
    },
    {
      id: "video-lipsync" as const,
      title: "Video Lipsync",
      description: "Add perfect lip-synchronization to existing videos with new audio tracks.",
      icon: "🎬",
      gradient: "from-green-500 to-blue-600",
      features: ["Multiple masked avatars", "Video and audio timeline", "Model: Infinite Talk with WAN 2.1"]
    },
    {
      id: "image-edit" as const,
      title: "Image Edit",
      description: "Edit and enhance images using AI-powered editing with natural language instructions.",
      icon: "✨",
      gradient: "from-purple-500 to-pink-600",
      features: ["AI image editing", "Models: Nano Banana"]
    },
    {
      id: "character-caption" as const,
      title: "Character Caption",
      description: "Generate detailed captions for character images to create training datasets for LoRA models.",
      icon: "📝",
      gradient: "from-indigo-500 to-purple-600",
      features: ["AI caption generation", "Batch processing", "Model: JoyCaption Beta 2"]
    },
    {
      id: "wan-i2v" as const,
      title: "WAN I2V",
      description: "Transform your images into captivating videos with AI-powered image-to-video generation.",
      icon: "🎬",
      gradient: "from-purple-600 to-pink-600",
      features: ["Image to video generation", "Custom prompts", "Model: WAN I2V"]
    },
    {
      id: "style-transfer" as const,
      title: "Style Transfer",
      description: "Transfer artistic styles between images using AI. Combine subject and style reference images to create unique artistic combinations.",
      icon: "🎨",
      gradient: "from-orange-500 to-red-600",
      features: ["Dual image input", "Artistic style transfer", "Model: Flux with USO Style Reference"]
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
            Your complete AI-powered media creation suite.
          </p>
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

        {/* External Tools Section */}
        <div className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">External Tools</h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Access powerful development and workflow tools to enhance your AI media creation process.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <button
              onClick={() => window.open('https://comfy.vapai.studio', '_blank')}
              className="group p-6 rounded-3xl bg-white/80 backdrop-blur-sm border border-gray-200/50 shadow-lg hover:shadow-2xl transform hover:scale-[1.02] transition-all duration-300 cursor-pointer text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-14 h-14 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl flex items-center justify-center text-2xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                  🔧
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                    <span className="text-gray-600">↗</span>
                  </div>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-orange-600 group-hover:to-red-600 transition-all duration-300">
                ComfyUI
              </h3>
              <p className="text-gray-600 mb-4 leading-relaxed">
                Advanced node-based workflow editor for AI image and video generation with custom pipelines.
              </p>
              <div className="inline-flex items-center gap-2 text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent">
                <span>Open Workflow Editor</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">→</span>
              </div>
            </button>
            
            <button
              onClick={() => window.open('https://notebook.vapai.studio', '_blank')}
              className="group p-6 rounded-3xl bg-white/80 backdrop-blur-sm border border-gray-200/50 shadow-lg hover:shadow-2xl transform hover:scale-[1.02] transition-all duration-300 cursor-pointer text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-2xl flex items-center justify-center text-2xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                  📓
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                    <span className="text-gray-600">↗</span>
                  </div>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3 group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:bg-clip-text group-hover:from-blue-600 group-hover:to-cyan-600 transition-all duration-300">
                Jupyter Notebook
              </h3>
              <p className="text-gray-600 mb-4 leading-relaxed">
                Interactive development environment for data science, AI experiments, and custom model training.
              </p>
              <div className="inline-flex items-center gap-2 text-sm font-medium bg-gradient-to-r from-blue-500 to-cyan-600 bg-clip-text text-transparent">
                <span>Launch Notebook</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">→</span>
              </div>
            </button>
          </div>
        </div>

        {/* Footer Info */}
        <div className="text-center space-y-4">
          <p className="text-xs text-gray-500 max-w-2xl mx-auto">
            Configure your ComfyUI URL in the navigation bar to get started. All processing happens in real-time with professional-grade AI models.
          </p>
        </div>
      </div>
    </div>
  );
}