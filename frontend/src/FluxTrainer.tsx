import { useState, useEffect } from "react";
import { Label, Field, Section } from "./components/UI";
import { config } from "./config/environment";

interface Props {
  comfyUrl?: string; // Currently unused but kept for consistency with other components
}

// Helper function for API calls
const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${config.apiBaseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Request failed with status ${response.status}`);
  }

  return response.json();
};

interface TrainingJob {
  id: string;
  job_name: string;
  status: string;
  progress_percentage: number;
  instance_prompt: string;
  class_prompt: string;
  num_images: number;
  num_epochs: number;
  learning_rate: number;
  network_rank: number;
  network_alpha: number;
  output_lora_url?: string;
  model_size_mb?: number;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

const STORAGE_KEY = 'fluxTrainer_settings';

export default function FluxTrainer({ }: Props) {
  // Load saved settings
  const loadSettings = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading saved settings:', error);
    }
    return null;
  };

  const savedSettings = loadSettings();

  // Form state
  const [jobName, setJobName] = useState<string>(savedSettings?.jobName || "");
  const [instancePrompt, setInstancePrompt] = useState<string>(savedSettings?.instancePrompt || "");
  const [classPrompt, setClassPrompt] = useState<string>(savedSettings?.classPrompt || "woman");
  const [numEpochs, setNumEpochs] = useState<number>(savedSettings?.numEpochs || 20);
  const [learningRate, setLearningRate] = useState<number>(savedSettings?.learningRate || 0.0001);
  const [networkRank, setNetworkRank] = useState<number>(savedSettings?.networkRank || 16);
  const [networkAlpha, setNetworkAlpha] = useState<number>(savedSettings?.networkAlpha || 8);
  const [repeats, setRepeats] = useState<number>(savedSettings?.repeats || 5);

  // File upload state
  const [selectedImages, setSelectedImages] = useState<FileList | null>(null);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);

  // Job state
  const [currentJobId, setCurrentJobId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [isCreatingJob, setIsCreatingJob] = useState<boolean>(false);
  const [isUploadingImages, setIsUploadingImages] = useState<boolean>(false);
  const [isStartingTraining, setIsStartingTraining] = useState<boolean>(false);

  // Training jobs list
  const [trainingJobs, setTrainingJobs] = useState<TrainingJob[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState<boolean>(false);

  // Save settings to localStorage
  useEffect(() => {
    const settings = {
      jobName,
      instancePrompt,
      classPrompt,
      numEpochs,
      learningRate,
      networkRank,
      networkAlpha,
      repeats
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }, [jobName, instancePrompt, classPrompt, numEpochs, learningRate, networkRank, networkAlpha, repeats]);

  // Auto-adjust network alpha when rank changes
  useEffect(() => {
    if (networkAlpha > networkRank) {
      setNetworkAlpha(Math.floor(networkRank / 2));
    }
  }, [networkRank]);

  // Handle image selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      setSelectedImages(null);
      setImagePreviewUrls([]);
      return;
    }

    setSelectedImages(files);

    // Generate preview URLs
    const urls: string[] = [];
    for (let i = 0; i < Math.min(files.length, 10); i++) {
      urls.push(URL.createObjectURL(files[i]));
    }
    setImagePreviewUrls(urls);
  };

  // Step 1: Create job
  const createJob = async () => {
    if (!jobName.trim()) {
      setStatus("❌ Please enter a job name");
      return;
    }
    if (!instancePrompt.trim()) {
      setStatus("❌ Please enter an instance prompt (e.g., 'Jenn')");
      return;
    }
    if (!classPrompt.trim()) {
      setStatus("❌ Please enter a class prompt (e.g., 'woman')");
      return;
    }

    setIsCreatingJob(true);
    setStatus("Creating training job...");

    try {
      const response = await apiRequest('/flux-trainer/jobs', {
        method: 'POST',
        body: JSON.stringify({
          job_name: jobName,
          instance_prompt: instancePrompt,
          class_prompt: classPrompt,
          num_epochs: numEpochs,
          learning_rate: learningRate,
          network_rank: networkRank,
          network_alpha: networkAlpha,
          repeats: repeats
        })
      });

      if (response.id) {
        setCurrentJobId(response.id);
        setStatus(`✅ Job created! ID: ${response.id.substring(0, 8)}... Now upload training images.`);
        loadTrainingJobs(); // Refresh job list
      } else {
        setStatus("❌ Failed to create job");
      }
    } catch (error: any) {
      setStatus(`❌ Error: ${error.message || 'Unknown error'}`);
    } finally {
      setIsCreatingJob(false);
    }
  };

  // Step 2: Upload images
  const uploadImages = async () => {
    if (!currentJobId) {
      setStatus("❌ Please create a job first");
      return;
    }
    if (!selectedImages || selectedImages.length === 0) {
      setStatus("❌ Please select training images");
      return;
    }
    if (selectedImages.length < 5) {
      setStatus("❌ Minimum 5 images required");
      return;
    }

    setIsUploadingImages(true);
    setStatus(`Uploading ${selectedImages.length} images...`);

    try {
      const formData = new FormData();
      for (let i = 0; i < selectedImages.length; i++) {
        formData.append('images', selectedImages[i]);
      }

      const token = localStorage.getItem('token');
      const response = await fetch(`${config.apiBaseUrl}/flux-trainer/jobs/${currentJobId}/upload-images`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        setStatus(`✅ ${data.num_images} images uploaded! Ready to start training.`);
        loadTrainingJobs(); // Refresh job list
      } else {
        setStatus(`❌ Upload failed: ${data.detail || 'Unknown error'}`);
      }
    } catch (error: any) {
      setStatus(`❌ Error: ${error.message || 'Unknown error'}`);
    } finally {
      setIsUploadingImages(false);
    }
  };

  // Step 3: Start training
  const startTraining = async () => {
    if (!currentJobId) {
      setStatus("❌ No job selected");
      return;
    }

    setIsStartingTraining(true);
    setStatus("Starting training...");

    try {
      const response = await apiRequest(`/flux-trainer/jobs/${currentJobId}/start`, {
        method: 'POST'
      });

      if (response.success) {
        setStatus(`✅ Training started! Monitor progress in the feed below.`);
        loadTrainingJobs(); // Refresh job list
      } else {
        setStatus(`❌ Failed to start training`);
      }
    } catch (error: any) {
      setStatus(`❌ Error: ${error.message || 'Unknown error'}`);
    } finally {
      setIsStartingTraining(false);
    }
  };

  // Load training jobs
  const loadTrainingJobs = async () => {
    setIsLoadingJobs(true);
    try {
      const response = await apiRequest('/flux-trainer/jobs?limit=50');
      if (response.jobs) {
        setTrainingJobs(response.jobs);
      }
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setIsLoadingJobs(false);
    }
  };

  // Load jobs on mount
  useEffect(() => {
    loadTrainingJobs();
    // Poll for updates every 10 seconds
    const interval = setInterval(loadTrainingJobs, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-orange-600 via-red-600 to-pink-600 bg-clip-text text-transparent">
              🎓 Flux LoRA Trainer
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Train custom Flux LoRAs with your own images. Perfect for creating consistent characters, styles, or objects.
            </p>
          </div>

          {/* Step 1: Job Configuration */}
          <Section title="Step 1: Configure Training Job">
            <Field>
              <Label>Job Name *</Label>
              <input
                type="text"
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="e.g., My Character LoRA"
              />
            </Field>

            <div className="grid md:grid-cols-2 gap-4">
              <Field>
                <Label>Instance Prompt * <span className="text-xs text-gray-500">(Subject identifier)</span></Label>
                <input
                  type="text"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                  value={instancePrompt}
                  onChange={(e) => setInstancePrompt(e.target.value)}
                  placeholder="e.g., Jenn, mydog, mystyle"
                />
              </Field>

              <Field>
                <Label>Class Prompt * <span className="text-xs text-gray-500">(General category)</span></Label>
                <input
                  type="text"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                  value={classPrompt}
                  onChange={(e) => setClassPrompt(e.target.value)}
                  placeholder="e.g., woman, dog, art style"
                />
              </Field>
            </div>

            <button
              onClick={createJob}
              disabled={isCreatingJob}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-orange-600 to-red-600 text-white font-bold shadow-lg hover:from-orange-700 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200"
            >
              {isCreatingJob ? "Creating..." : "Create Job"}
            </button>
          </Section>

          {/* Step 2: Upload Images */}
          {currentJobId && (
            <Section title="Step 2: Upload Training Images">
              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4 rounded-r-xl">
                <p className="text-sm text-blue-800">
                  <strong>Tips for best results:</strong><br />
                  • Upload 20-100 images of your subject<br />
                  • Use clear, well-lit photos<br />
                  • Include multiple angles and expressions<br />
                  • 1024x1024 resolution recommended<br />
                  • Avoid complex backgrounds
                </p>
              </div>

              <Field>
                <Label>Select Images (5-200)</Label>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-orange-500 file:to-red-600 file:text-white file:font-semibold hover:file:from-orange-600 hover:file:to-red-700 transition-all duration-200 bg-gray-50/50"
                />
                {selectedImages && (
                  <p className="text-sm text-gray-600 mt-2">
                    {selectedImages.length} image{selectedImages.length !== 1 ? 's' : ''} selected
                  </p>
                )}
              </Field>

              {imagePreviewUrls.length > 0 && (
                <div className="grid grid-cols-5 gap-2 mt-4">
                  {imagePreviewUrls.map((url, idx) => (
                    <img
                      key={idx}
                      src={url}
                      alt={`Preview ${idx + 1}`}
                      className="w-full h-24 object-cover rounded-lg border border-gray-200"
                    />
                  ))}
                  {selectedImages && selectedImages.length > 10 && (
                    <div className="w-full h-24 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 text-sm">
                      +{selectedImages.length - 10} more
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={uploadImages}
                disabled={isUploadingImages || !selectedImages}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-orange-600 to-red-600 text-white font-bold shadow-lg hover:from-orange-700 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200"
              >
                {isUploadingImages ? "Uploading..." : "Upload Images"}
              </button>
            </Section>
          )}

          {/* Advanced Settings */}
          <Section title="Advanced Settings">
            <div className="grid md:grid-cols-2 gap-4">
              <Field>
                <Label>Epochs <span className="text-xs text-gray-500">(Training cycles)</span></Label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                  value={numEpochs}
                  onChange={(e) => setNumEpochs(parseInt(e.target.value))}
                />
                <p className="text-xs text-gray-500 mt-1">Recommended: 20-50 for most cases</p>
              </Field>

              <Field>
                <Label>Learning Rate</Label>
                <input
                  type="number"
                  step="0.00001"
                  min="0.00001"
                  max="1"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                  value={learningRate}
                  onChange={(e) => setLearningRate(parseFloat(e.target.value))}
                />
                <p className="text-xs text-gray-500 mt-1">Recommended: 0.0001-0.0003</p>
              </Field>

              <Field>
                <Label>Network Rank <span className="text-xs text-gray-500">(LoRA dimension)</span></Label>
                <input
                  type="number"
                  min="4"
                  max="256"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                  value={networkRank}
                  onChange={(e) => setNetworkRank(parseInt(e.target.value))}
                />
                <p className="text-xs text-gray-500 mt-1">Higher = more detail, larger file (16-64 typical)</p>
              </Field>

              <Field>
                <Label>Network Alpha <span className="text-xs text-gray-500">(Regularization)</span></Label>
                <input
                  type="number"
                  min="1"
                  max="256"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                  value={networkAlpha}
                  onChange={(e) => setNetworkAlpha(parseInt(e.target.value))}
                />
                <p className="text-xs text-gray-500 mt-1">Typically half of Network Rank</p>
              </Field>

              <Field>
                <Label>Repeats <span className="text-xs text-gray-500">(Per image)</span></Label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                  value={repeats}
                  onChange={(e) => setRepeats(parseInt(e.target.value))}
                />
                <p className="text-xs text-gray-500 mt-1">More images = lower repeats (5 typical)</p>
              </Field>
            </div>
          </Section>

          {/* Step 3: Start Training */}
          {currentJobId && (
            <Section title="Step 3: Start Training">
              <div className="space-y-4">
                <button
                  onClick={startTraining}
                  disabled={isStartingTraining}
                  className="px-8 py-4 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold text-lg shadow-lg hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                >
                  {isStartingTraining ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Starting...
                    </>
                  ) : (
                    <>
                      <span>🚀</span>
                      Start Training
                    </>
                  )}
                </button>

                {status && (
                  <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <p className="text-sm text-gray-700">{status}</p>
                  </div>
                )}

                <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded-r-xl">
                  <p className="text-sm text-yellow-800">
                    <strong>Note:</strong> Training can take 30 minutes to several hours depending on settings and GPU availability. Monitor progress in the Training Jobs list below.
                  </p>
                </div>
              </div>
            </Section>
          )}
        </div>

        {/* Right Sidebar - Training Jobs Feed */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
            <Section title="Training Jobs">
              {isLoadingJobs && trainingJobs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <div className="w-8 h-8 border-2 border-gray-300 border-t-orange-600 rounded-full animate-spin mx-auto mb-2"></div>
                  Loading jobs...
                </div>
              ) : trainingJobs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No training jobs yet. Create your first one above!
                </div>
              ) : (
                <div className="space-y-3">
                  {trainingJobs.map((job) => (
                    <div key={job.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900">{job.job_name}</h3>
                          <p className="text-xs text-gray-500">{job.instance_prompt}</p>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          job.status === 'completed' ? 'bg-green-100 text-green-700' :
                          job.status === 'training' ? 'bg-blue-100 text-blue-700' :
                          job.status === 'failed' ? 'bg-red-100 text-red-700' :
                          job.status === 'cancelled' ? 'bg-gray-100 text-gray-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {job.status}
                        </span>
                      </div>

                      {job.status === 'training' && (
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-orange-500 to-red-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${job.progress_percentage}%` }}
                          />
                        </div>
                      )}

                      <div className="text-xs text-gray-600 space-y-1">
                        <div>Images: {job.num_images || 0} | Epochs: {job.num_epochs}</div>
                        {job.status === 'completed' && job.output_lora_url && (
                          <a
                            href={job.output_lora_url}
                            download
                            className="inline-block mt-2 px-3 py-1 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-lg text-xs font-medium hover:from-orange-600 hover:to-red-700 transition-all"
                          >
                            ⬇️ Download LoRA ({job.model_size_mb?.toFixed(1)} MB)
                          </a>
                        )}
                        {job.error_message && (
                          <div className="text-red-600 text-xs mt-2">
                            Error: {job.error_message}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
