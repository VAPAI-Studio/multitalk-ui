import { useExecutionBackend } from '../contexts/ExecutionBackendContext';

export default function ExecutionBackendToggle() {
  const { backend, setBackend, isRunPodEnabled, isRunPodConfigured, loading } = useExecutionBackend();

  if (loading) {
    return null; // Don't show anything while loading
  }

  // Don't show toggle if RunPod is not enabled/configured
  if (!isRunPodEnabled || !isRunPodConfigured) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 transition-colors">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Execution:
      </span>

      <div className="flex rounded-lg bg-white dark:bg-gray-900 p-1 shadow-inner">
        <button
          onClick={() => setBackend('comfyui')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
            backend === 'comfyui'
              ? 'bg-blue-500 text-white shadow-md transform scale-105'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          title="Execute workflows on local/self-hosted ComfyUI server"
        >
          🖥️ Local
        </button>

        <button
          onClick={() => setBackend('runpod')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
            backend === 'runpod'
              ? 'bg-purple-500 text-white shadow-md transform scale-105'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          title="Execute workflows on RunPod serverless cloud"
        >
          ☁️ Cloud
        </button>
      </div>

      <span className="text-xs text-gray-500 dark:text-gray-400">
        {backend === 'comfyui' ? 'ComfyUI' : 'RunPod'}
      </span>
    </div>
  );
}
