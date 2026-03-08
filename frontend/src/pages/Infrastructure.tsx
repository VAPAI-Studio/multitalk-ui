import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { FileTree } from "../components/FileTree";
import { FileUpload } from "../components/FileUpload";
import { HFDownload } from "../components/HFDownload";
import { DockerfileEditor } from "../components/DockerfileEditor";

interface Props {
  comfyUrl: string;
}

export default function Infrastructure({ comfyUrl: _comfyUrl }: Props) {
  const { isAdmin } = useAuth();
  const [currentPath, setCurrentPath] = useState<string>("");
  const [fileTreeRefreshId, setFileTreeRefreshId] = useState(0);

  // Admin-only access control
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-3xl border border-red-200/80 p-8 shadow-lg bg-white text-center space-y-4">
          <div className="text-6xl">🚫</div>
          <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
          <p className="text-gray-600">
            This section is restricted to administrators only. If you believe you should have access, please contact your system administrator.
          </p>
        </div>
      </div>
    );
  }

  const handleTreeRefresh = () => setFileTreeRefreshId(id => id + 1);

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

          {/* File Browser — refreshId prop triggers internal reload without remounting */}
          <div className="space-y-4">
            <FileTree
              refreshId={fileTreeRefreshId}
              currentPath={currentPath}
              onNavigate={setCurrentPath}
            />
          </div>

          {/* Upload to Network Volume */}
          <FileUpload
            targetPath={currentPath}
            onUploadComplete={handleTreeRefresh}
          />

          {/* Download from HuggingFace directly to volume */}
          <HFDownload
            targetPath={currentPath}
            onComplete={handleTreeRefresh}
          />

          {/* Edit Dockerfile — in-browser Monaco editor backed by GitHub */}
          <DockerfileEditor />

          {/* Instructions Card */}
          <div className="rounded-3xl border border-blue-200/80 p-6 shadow-lg bg-gradient-to-br from-blue-50 to-white">
            <h2 className="text-lg font-bold text-blue-900 mb-3 flex items-center gap-2">
              <span>ℹ️</span>
              Setup Instructions
            </h2>
            <div className="space-y-2 text-sm text-blue-800">
              <p>To use the file browser, configure your RunPod S3 credentials in the backend .env file:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-blue-700">
                <li>RUNPOD_S3_ACCESS_KEY</li>
                <li>RUNPOD_S3_SECRET_KEY</li>
                <li>RUNPOD_NETWORK_VOLUME_ID</li>
                <li>RUNPOD_S3_ENDPOINT_URL</li>
                <li>RUNPOD_S3_REGION</li>
              </ul>
              <p className="mt-3 text-xs text-blue-600">
                Get these credentials from: RunPod Dashboard → Storage → Network Volumes → S3 API Access
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
