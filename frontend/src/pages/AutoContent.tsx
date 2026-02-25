import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProject } from '../contexts/ProjectContext';
import { apiClient } from '../lib/apiClient';

interface Props {
  comfyUrl: string;
}

// UI Components (reuse existing patterns)
function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={className || "block text-sm font-semibold text-gray-800 mb-2"}>{children}</label>;
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
        <div className="w-2 h-8 bg-gradient-to-b from-indigo-500 to-purple-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function AutoContent({ comfyUrl }: Props) {
  const { user } = useAuth();
  const { selectedProject, projects, selectProject } = useProject();

  const [currentStep, setCurrentStep] = useState<'setup' | 'generate'>('setup');
  const [status, setStatus] = useState<string>('');
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [batchJobId, setBatchJobId] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{
    total_jobs: number;
    completed_jobs: number;
    failed_jobs: number;
    total_master_frames: number;
    completed_master_frames: number;
  } | null>(null);

  async function validateAndCreateBatchJob() {
    if (!selectedProject) {
      setStatus('❌ Please select a project');
      return;
    }

    if (!comfyUrl) {
      setStatus('❌ Please enter a ComfyUI URL in the header');
      return;
    }

    if (!user) {
      setStatus('❌ Please log in to use this feature');
      return;
    }

    setIsValidating(true);
    setStatus('🔍 Validating project structure...');

    try {
      // Call backend API to create batch job
      const data = await apiClient.createBatchJob({
        user_id: user.id,
        project_folder_id: selectedProject.id,
        comfy_url: comfyUrl
      });

      if (data.success && data.batch_job) {
        setBatchJobId(data.batch_job.id);

        // Show which script was selected
        const scriptInfo = data.batch_job.script_filename
          ? ` Script: ${data.batch_job.script_filename}`
          : '';
        setStatus(`✅ Project validated! Ready to generate.${scriptInfo}`);
        setCurrentStep('generate');

        // Save batch job ID to localStorage
        localStorage.setItem('auto_content_batch_job_id', data.batch_job.id);

        // Set initial progress
        setBatchProgress({
          total_jobs: data.batch_job.total_jobs || 0,
          completed_jobs: data.batch_job.completed_jobs || 0,
          failed_jobs: data.batch_job.failed_jobs || 0,
          total_master_frames: data.batch_job.total_master_frames || 0,
          completed_master_frames: data.batch_job.completed_master_frames || 0
        });
      } else {
        setStatus(`❌ Validation failed: ${data.error || 'Unknown error'}`);
      }

    } catch (error: any) {
      setStatus(`❌ Error: ${error.message || 'Failed to connect to backend'}`);
    } finally {
      setIsValidating(false);
    }
  }

  async function startGeneration() {
    if (!batchJobId) {
      setStatus('❌ No batch job ID');
      return;
    }

    setIsGenerating(true);
    setStatus('🚀 Starting master frame generation...');

    try {
      const data = await apiClient.startBatchGeneration(batchJobId, {
        master_frame_variations: 3
      });

      if (data.success && data.batch_job) {
        setStatus('✅ Generation started! Jobs are being processed...');

        // Update progress
        setBatchProgress({
          total_jobs: data.batch_job.total_jobs || 0,
          completed_jobs: data.batch_job.completed_jobs || 0,
          failed_jobs: data.batch_job.failed_jobs || 0,
          total_master_frames: data.batch_job.total_master_frames || 0,
          completed_master_frames: data.batch_job.completed_master_frames || 0
        });

        // Start polling for progress
        startProgressPolling();
      } else {
        setStatus(`❌ Failed to start generation: ${data.error || 'Unknown error'}`);
        setIsGenerating(false);
      }

    } catch (error: any) {
      setStatus(`❌ Error: ${error.message || 'Failed to start generation'}`);
      setIsGenerating(false);
    }
  }

  function startProgressPolling() {
    const pollInterval = setInterval(async () => {
      if (!batchJobId) {
        clearInterval(pollInterval);
        return;
      }

      try {
        const data = await apiClient.getBatchJob(batchJobId);

        if (data.success && data.batch_job) {
          setBatchProgress({
            total_jobs: data.batch_job.total_jobs || 0,
            completed_jobs: data.batch_job.completed_jobs || 0,
            failed_jobs: data.batch_job.failed_jobs || 0,
            total_master_frames: data.batch_job.total_master_frames || 0,
            completed_master_frames: data.batch_job.completed_master_frames || 0
          });

          // Check if completed
          if (data.batch_job.status === 'completed' || data.batch_job.status === 'failed') {
            clearInterval(pollInterval);
            setIsGenerating(false);

            if (data.batch_job.status === 'completed') {
              setStatus('✅ All generations completed!');
            } else {
              setStatus(`❌ Batch job failed: ${data.batch_job.error_message || 'Unknown error'}`);
            }
          }
        }
      } catch (error: any) {
        console.error('Progress polling error:', error);
      }
    }, 5000); // Poll every 5 seconds

    // Clean up on component unmount
    return () => clearInterval(pollInterval);
  }

  function ProjectSetupSection() {
    return (
      <Section title="Project Setup">
        <Field>
          <Label>Select Google Drive Project</Label>
          <select
            className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all duration-200 bg-white/80"
            value={selectedProject?.id || ''}
            onChange={(e) => {
              const project = projects.find(p => p.id === e.target.value);
              selectProject(project || null);
            }}
          >
            <option value="">-- Select a project --</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-2">
            Project must contain GENERAL_ASSETS/ with Script/ folder (at least one .pdf, .doc, .docx, or Google Docs file)
          </p>
        </Field>

        {selectedProject && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-2xl">
            <p className="text-sm text-blue-800">
              <strong>Selected:</strong> {selectedProject.name}
            </p>
          </div>
        )}

        <div className="mt-6">
          <button
            className="px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-lg shadow-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
            onClick={validateAndCreateBatchJob}
            disabled={isValidating || !selectedProject}
          >
            {isValidating ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Validating...
              </>
            ) : (
              <>
                <span>🔍</span>
                Validate Project Structure
              </>
            )}
          </button>

          {status && (
            <p className="mt-4 text-sm">{status}</p>
          )}
        </div>

        <div className="mt-8 p-6 bg-gray-50 border border-gray-200 rounded-2xl">
          <h3 className="font-bold text-gray-800 mb-3">Required Folder Structure:</h3>
          <pre className="text-xs text-gray-700 overflow-x-auto">
{`ProjectFolder/
  GENERAL_ASSETS/
    Script/           (REQUIRED: at least one .pdf, .doc, .docx, or Google Docs)
    Master_Frames/    (optional: images for batch generation)
    Characters/       (optional: character reference images)
    Props/            (optional: prop reference images)
    Settings/         (optional: setting/location reference images)`}
          </pre>
          <p className="text-xs text-gray-500 mt-3">
            💡 You can start with just the Script/ folder and add other folders later as needed.
          </p>
        </div>
      </Section>
    );
  }

  function GenerationSection() {
    const progressPercentage = batchProgress && batchProgress.total_jobs > 0
      ? Math.round((batchProgress.completed_jobs / batchProgress.total_jobs) * 100)
      : 0;

    return (
      <Section title="Batch Generation">
        <div className="space-y-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-800 mb-4">🎉 Project Validated!</p>

            {status && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-2xl">
                <p className="text-sm text-green-800">{status}</p>
              </div>
            )}

            <div className="mb-6 space-y-2">
              <p className="text-sm text-gray-600">
                Batch Job ID: <code className="bg-gray-100 px-2 py-1 rounded text-xs">{batchJobId}</code>
              </p>
              {selectedProject && (
                <p className="text-sm text-gray-600">
                  Project: <strong>{selectedProject.name}</strong>
                </p>
              )}
            </div>
          </div>

          {/* Progress Section */}
          {batchProgress && (batchProgress.total_jobs > 0 || isGenerating) && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-md">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Generation Progress</h3>

              {/* Progress Bar */}
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>Master Frames: {batchProgress.completed_master_frames}/{batchProgress.total_master_frames}</span>
                  <span>{batchProgress.completed_jobs}/{batchProgress.total_jobs} jobs ({progressPercentage}%)</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="text-center p-3 bg-blue-50 rounded-xl">
                  <p className="text-2xl font-bold text-blue-600">{batchProgress.completed_jobs}</p>
                  <p className="text-xs text-gray-600">Completed</p>
                </div>
                <div className="text-center p-3 bg-yellow-50 rounded-xl">
                  <p className="text-2xl font-bold text-yellow-600">
                    {batchProgress.total_jobs - batchProgress.completed_jobs - batchProgress.failed_jobs}
                  </p>
                  <p className="text-xs text-gray-600">Pending</p>
                </div>
                <div className="text-center p-3 bg-red-50 rounded-xl">
                  <p className="text-2xl font-bold text-red-600">{batchProgress.failed_jobs}</p>
                  <p className="text-xs text-gray-600">Failed</p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 justify-center">
            {!isGenerating && batchProgress && batchProgress.total_jobs === 0 && (
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-lg shadow-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={startGeneration}
                disabled={isGenerating}
              >
                <span>🚀</span>
                Start Generation
              </button>
            )}

            {isGenerating && (
              <div className="px-6 py-3 rounded-2xl bg-indigo-100 text-indigo-800 font-semibold flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-800 rounded-full animate-spin"></div>
                Generating...
              </div>
            )}

            <button
              className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200"
              onClick={() => {
                setCurrentStep('setup');
                setBatchJobId('');
                setStatus('');
                setBatchProgress(null);
                setIsGenerating(false);
                localStorage.removeItem('auto_content_batch_job_id');
              }}
            >
              ← Back to Setup
            </button>
          </div>

          {/* Future Features Note */}
          <div className="p-6 bg-blue-50 border border-blue-200 rounded-2xl">
            <p className="text-sm text-blue-800">
              <strong>Coming Soon:</strong><br/>
              ✨ Phase 2: Script analysis and outline generation<br/>
              🎬 Phase 4: Review and management interface with star/delete actions
            </p>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="flex gap-6 p-6 md:p-10">
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              Auto Content
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Automate content production from scripts with batch image generation from master frames
            </p>
          </div>

          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <div className={`flex items-center gap-2 ${currentStep === 'setup' ? 'text-indigo-600 font-bold' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep === 'setup' ? 'bg-indigo-600 text-white' : 'bg-gray-300 text-gray-600'}`}>
                1
              </div>
              <span>Project Setup</span>
            </div>
            <div className="w-12 h-0.5 bg-gray-300"></div>
            <div className={`flex items-center gap-2 ${currentStep === 'generate' ? 'text-indigo-600 font-bold' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep === 'generate' ? 'bg-indigo-600 text-white' : 'bg-gray-300 text-gray-600'}`}>
                2
              </div>
              <span>Generate</span>
            </div>
          </div>

          {/* Content */}
          {currentStep === 'setup' && <ProjectSetupSection />}
          {currentStep === 'generate' && <GenerationSection />}
        </div>
      </div>
    </div>
  );
}
