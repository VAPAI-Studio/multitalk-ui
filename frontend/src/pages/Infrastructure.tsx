import React from "react";

interface Props {
  comfyUrl: string;
}

export default function Infrastructure({ comfyUrl }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-gray-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-slate-600 via-gray-600 to-slate-700 bg-clip-text text-transparent">
              Infrastructure Manager
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Manage RunPod infrastructure, browse network volumes, and edit workflow Dockerfiles.
            </p>
          </div>

          {/* Placeholder Content */}
          <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
              <div className="w-2 h-8 bg-gradient-to-b from-slate-500 to-gray-700 rounded-full"></div>
              Coming in Phase 2
            </h2>
            <div className="space-y-4 text-gray-600">
              <p>Infrastructure management features will be added in upcoming phases:</p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li><strong>Phase 2:</strong> Network Volume File Browser</li>
                <li><strong>Phase 3:</strong> File Upload and Download</li>
                <li><strong>Phase 4:</strong> File Operations (delete, move, rename)</li>
                <li><strong>Phase 5:</strong> HuggingFace Direct Downloads</li>
                <li><strong>Phase 6:</strong> Dockerfile Editor</li>
                <li><strong>Phase 7:</strong> GitHub Integration</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
