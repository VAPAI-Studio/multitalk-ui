import React, { useEffect, useState } from "react";
import { apiClient } from "./lib/apiClient";

// UI Components (reuse these patterns)
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
        <div className="w-2 h-8 bg-gradient-to-b from-orange-500 to-red-600 rounded-full"></div>
        {title}
      </h2>
      {children}
    </div>
  );
}

interface Dataset {
  id: string;
  name: string;
  created_at: string;
  image_count?: number;
}

interface DatasetImage {
  id: string;
  image_name: string;
  caption: string;
  image_url: string;
  dataset_id: string;
  created_at: string;
}

interface TrainingJob {
  job_id: string;
  status: string;
  progress?: number;
  current_epoch?: number;
  current_step?: number;
  total_steps?: number;
  loss?: number;
  message?: string;
  output_path?: string;
  dataset_id?: string;
}

export default function LoRATrainer() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [datasetImages, setDatasetImages] = useState<DatasetImage[]>([]);
  const [outputName, setOutputName] = useState<string>("");

  // Training parameters
  const [networkDim, setNetworkDim] = useState<number>(16);
  const [networkAlpha, setNetworkAlpha] = useState<number>(1.0);
  const [learningRate, setLearningRate] = useState<number>(0.00005);
  const [maxEpochs, setMaxEpochs] = useState<number>(16);
  const [seed, setSeed] = useState<number>(42);
  const [resolution, setResolution] = useState<[number, number]>([1024, 1024]);

  // Job tracking
  const [status, setStatus] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [currentJob, setCurrentJob] = useState<TrainingJob | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [jobHistory, setJobHistory] = useState<TrainingJob[]>([]);

  // Load datasets on mount
  useEffect(() => {
    loadDatasets();
    loadJobHistory();

    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load dataset images when selected
  useEffect(() => {
    if (selectedDataset) {
      loadDatasetImages(selectedDataset);
    }
  }, [selectedDataset]);

  async function loadDatasets() {
    try {
      const response: any = await apiClient.getAllDatasets();
      if (response.success && response.datasets) {
        setDatasets(response.datasets);
      }
    } catch (error) {
      console.error("Failed to load datasets:", error);
      setStatus("❌ Failed to load datasets");
    }
  }

  async function loadDatasetImages(datasetId: string) {
    try {
      const response: any = await apiClient.loadDataset(datasetId);
      console.log("Dataset response:", response);

      if (response.success && response.data) {
        // Images are in the "data" array (DataEntry objects with image_url, image_name, caption)
        const images = response.data || [];
        console.log("Images found:", images);
        setDatasetImages(images);

        if (images.length === 0) {
          setStatus("⚠️ Dataset loaded but contains no images");
        } else {
          setStatus(`✅ Loaded ${images.length} images from dataset`);
        }
      } else {
        console.error("Dataset response structure unexpected:", response);
        setStatus("❌ Failed to load dataset");
      }
    } catch (error) {
      console.error("Failed to load dataset images:", error);
      setStatus("❌ Failed to load dataset images");
    }
  }

  async function loadJobHistory() {
    try {
      const jobs: any = await apiClient.getMusubiTrainingJobs();
      if (jobs.success && jobs.jobs) {
        setJobHistory(jobs.jobs);
      }
    } catch (error) {
      console.error("Failed to load job history:", error);
    }
  }

  async function startTraining() {
    if (!selectedDataset) {
      setStatus("❌ Please select a dataset");
      return;
    }

    if (!outputName.trim()) {
      setStatus("❌ Please enter an output name");
      return;
    }

    if (datasetImages.length === 0) {
      setStatus("❌ Selected dataset has no images");
      return;
    }

    setIsSubmitting(true);
    setStatus("📦 Preparing training data...");

    try {
      // Convert dataset images to base64
      const imagesData = await Promise.all(
        datasetImages.map(async (img) => {
          // Fetch the image and convert to base64
          const response = await fetch(img.image_url);
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              resolve(result.split(',')[1]); // Remove data URL prefix
            };
            reader.readAsDataURL(blob);
          });

          return {
            filename: img.image_name,
            data: base64,
            caption: img.caption
          };
        })
      );

      setStatus("🚀 Starting training...");

      // Submit to Musubi Tuner API
      const response: any = await apiClient.startMusubiTraining({
        images: imagesData,
        output_name: outputName,
        network_dim: networkDim,
        network_alpha: networkAlpha,
        learning_rate: learningRate,
        max_train_epochs: maxEpochs,
        seed: seed,
        resolution: resolution
      });

      if (response.success && response.job_id) {
        setCurrentJob({
          job_id: response.job_id,
          status: response.status,
          message: response.message,
          dataset_id: response.dataset_id
        });

        setStatus(`✅ Training started! Job ID: ${response.job_id}`);

        // Start polling for status
        startStatusPolling(response.job_id);
      } else {
        throw new Error(response.error || "Failed to start training");
      }
    } catch (error: any) {
      setStatus(`❌ Error: ${error.message || 'Unknown error'}`);
      setIsSubmitting(false);
    }
  }

  function startStatusPolling(jobId: string) {
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }

    const interval = setInterval(async () => {
      try {
        const response: any = await apiClient.getMusubiTrainingStatus(jobId);

        if (response.success && response.job) {
          setCurrentJob(response.job);

          // Update status message
          let statusMsg = response.job.message || `Status: ${response.job.status}`;
          if (response.job.progress !== undefined && response.job.progress !== null) {
            statusMsg += ` (${response.job.progress.toFixed(1)}%)`;
          }
          if (response.job.current_epoch && response.job.current_step) {
            statusMsg += ` - Epoch ${response.job.current_epoch}, Step ${response.job.current_step}/${response.job.total_steps}`;
          }
          if (response.job.loss !== undefined && response.job.loss !== null) {
            statusMsg += ` - Loss: ${response.job.loss.toFixed(4)}`;
          }
          setStatus(statusMsg);

          // Stop polling if completed or failed
          if (response.job.status === 'completed' || response.job.status === 'failed' || response.job.status === 'cancelled') {
            if (pollingInterval) {
              clearInterval(pollingInterval);
              setPollingInterval(null);
            }
            setIsSubmitting(false);

            if (response.job.status === 'completed') {
              setStatus(`✅ Training completed! Output: ${response.job.output_path}`);
            } else if (response.job.status === 'failed') {
              setStatus(`❌ Training failed: ${response.job.message}`);
            }

            loadJobHistory();
          }
        }
      } catch (error) {
        console.error("Failed to poll status:", error);
      }
    }, 2000); // Poll every 2 seconds

    setPollingInterval(interval);
  }

  async function cancelTraining() {
    if (!currentJob?.job_id) return;

    try {
      await apiClient.cancelMusubiTraining(currentJob.job_id);
      setStatus("⚠️ Training cancelled");
      if (pollingInterval) {
        clearInterval(pollingInterval);
        setPollingInterval(null);
      }
      setIsSubmitting(false);
      loadJobHistory();
    } catch (error) {
      console.error("Failed to cancel training:", error);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-orange-600 via-red-600 to-pink-600 bg-clip-text text-transparent">
              LoRA Trainer
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Train custom QWEN Image LoRA models using your own datasets. Perfect for creating consistent characters, styles, or objects.
            </p>
          </div>

          {/* Dataset Selection */}
          <Section title="Select Dataset">
            <Field>
              <Label>Dataset</Label>
              <select
                value={selectedDataset}
                onChange={(e) => setSelectedDataset(e.target.value)}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
              >
                <option value="">Select a dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name} ({dataset.image_count || 0} images)
                  </option>
                ))}
              </select>
            </Field>

            {datasetImages.length > 0 && (
              <div className="mt-4">
                <Label>Dataset Preview ({datasetImages.length} images)</Label>
                <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                  {datasetImages.slice(0, 12).map((img) => (
                    <div key={img.id} className="relative group">
                      <img
                        src={img.image_url}
                        alt={img.image_name}
                        className="w-full h-24 object-cover rounded-lg"
                      />
                      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-1 flex items-center justify-center">
                        <p className="text-white text-xs text-center line-clamp-3">{img.caption}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Training Configuration */}
          <Section title="Training Configuration">
            <Field>
              <Label>Output Name</Label>
              <input
                type="text"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                placeholder="my_lora_model"
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
              />
              <p className="text-xs text-gray-500 mt-1">Name for the output LoRA file (without extension)</p>
            </Field>

            <div className="grid md:grid-cols-2 gap-4">
              <Field>
                <Label>Network Dimension (Rank)</Label>
                <input
                  type="number"
                  min="1"
                  max="256"
                  value={networkDim}
                  onChange={(e) => setNetworkDim(parseInt(e.target.value))}
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                />
                <p className="text-xs text-gray-500 mt-1">Higher = more detail, slower training (1-256)</p>
              </Field>

              <Field>
                <Label>Network Alpha</Label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  value={networkAlpha}
                  onChange={(e) => setNetworkAlpha(parseFloat(e.target.value))}
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                />
                <p className="text-xs text-gray-500 mt-1">Alpha scaling factor</p>
              </Field>

              <Field>
                <Label>Learning Rate</Label>
                <input
                  type="number"
                  step="0.00001"
                  min="0.00001"
                  max="0.001"
                  value={learningRate}
                  onChange={(e) => setLearningRate(parseFloat(e.target.value))}
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                />
                <p className="text-xs text-gray-500 mt-1">Recommended: 0.00005</p>
              </Field>

              <Field>
                <Label>Max Epochs</Label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={maxEpochs}
                  onChange={(e) => setMaxEpochs(parseInt(e.target.value))}
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                />
                <p className="text-xs text-gray-500 mt-1">Number of training epochs</p>
              </Field>

              <Field>
                <Label>Random Seed</Label>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(parseInt(e.target.value))}
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                />
                <p className="text-xs text-gray-500 mt-1">For reproducible results</p>
              </Field>

              <Field>
                <Label>Resolution</Label>
                <select
                  value={resolution.join(',')}
                  onChange={(e) => {
                    const [w, h] = e.target.value.split(',').map(Number);
                    setResolution([w, h]);
                  }}
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all duration-200 bg-white/80"
                >
                  <option value="512,512">512x512</option>
                  <option value="768,768">768x768</option>
                  <option value="1024,1024">1024x1024</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">Training image resolution</p>
              </Field>
            </div>
          </Section>

          {/* Start Training */}
          <Section title="Train">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-orange-600 to-red-600 text-white font-bold text-lg shadow-lg hover:from-orange-700 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={startTraining}
                disabled={isSubmitting || !selectedDataset || !outputName}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Training...
                  </>
                ) : (
                  <>
                    <span>🎓</span>
                    Start Training
                  </>
                )}
              </button>

              {isSubmitting && currentJob && (
                <button
                  className="px-6 py-4 rounded-2xl border-2 border-red-500 text-red-700 font-semibold hover:bg-red-50 transition-all duration-200"
                  onClick={cancelTraining}
                >
                  Cancel Training
                </button>
              )}

              {status && <span className="text-sm">{status}</span>}
            </div>

            {/* Progress Bar */}
            {currentJob && currentJob.progress !== undefined && currentJob.progress !== null && (
              <div className="mt-6">
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Training Progress</span>
                  <span className="text-sm text-gray-600">{currentJob.progress.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-orange-500 to-red-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${currentJob.progress}%` }}
                  ></div>
                </div>
                {currentJob.current_epoch && (
                  <p className="text-xs text-gray-500 mt-2">
                    Epoch {currentJob.current_epoch}/{maxEpochs} • Step {currentJob.current_step}/{currentJob.total_steps}
                    {currentJob.loss !== undefined && currentJob.loss !== null && ` • Loss: ${currentJob.loss.toFixed(4)}`}
                  </p>
                )}
              </div>
            )}

            {/* Completed Output */}
            {currentJob?.status === 'completed' && currentJob.output_path && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-2xl">
                <p className="text-green-800 font-semibold mb-2">✅ Training Complete!</p>
                <p className="text-sm text-green-700">
                  LoRA saved to: <code className="bg-green-100 px-2 py-1 rounded">{currentJob.output_path}</code>
                </p>
              </div>
            )}
          </Section>
        </div>

        {/* Right Sidebar - Job History */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6">
            <Section title="Training History">
              <div className="space-y-3 max-h-[calc(100vh-12rem)] overflow-y-auto">
                {jobHistory.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-8">No training jobs yet</p>
                ) : (
                  jobHistory.map((job) => (
                    <div
                      key={job.job_id}
                      className="p-4 bg-white rounded-xl border border-gray-200 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-sm font-semibold text-gray-900">
                          {job.job_id.substring(0, 8)}...
                        </span>
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${
                            job.status === 'completed'
                              ? 'bg-green-100 text-green-700'
                              : job.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : job.status === 'training'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {job.status}
                        </span>
                      </div>
                      {job.message && (
                        <p className="text-xs text-gray-600 mb-1">{job.message}</p>
                      )}
                      {job.progress !== undefined && (
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                          <div
                            className="bg-gradient-to-r from-orange-500 to-red-600 h-1.5 rounded-full"
                            style={{ width: `${job.progress}%` }}
                          ></div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
