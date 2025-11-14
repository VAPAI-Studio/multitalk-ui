import { useState, useEffect } from "react";
import { Label, Field, Section } from "./components/UI";
import { apiClient } from "./lib/apiClient";
import ImageFeed from "./components/ImageFeed";
import { useSmartResolution } from "./hooks/useSmartResolution";

interface Props {
  comfyUrl?: string;
}

interface LoraConfig {
  id: string;
  name: string;
  strength: number;
  enabled: boolean;
}

const STORAGE_KEY = 'fluxLora_settings';

export default function FluxLora({ comfyUrl = "" }: Props) {
  // Load saved settings from localStorage
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

  const [prompt, setPrompt] = useState<string>(savedSettings?.prompt || "");
  const [steps, setSteps] = useState<number>(savedSettings?.steps || 30);
  const [seed, setSeed] = useState<number>(savedSettings?.seed || 42);
  const [loras, setLoras] = useState<LoraConfig[]>(savedSettings?.loras || []);
  const [availableLoras, setAvailableLoras] = useState<string[]>([]);
  const [isLoadingLoras, setIsLoadingLoras] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [resultUrl, setResultUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");

  const {
    width,
    height,
    widthInput,
    heightInput,
    handleWidthChange,
    handleHeightChange,
    setWidth,
    setHeight
  } = useSmartResolution(
    savedSettings?.width || 1024,
    savedSettings?.height || 1024
  );

  // Aspect ratio lock state
  const [aspectRatioLocked, setAspectRatioLocked] = useState<boolean>(
    savedSettings?.aspectRatioLocked !== undefined ? savedSettings.aspectRatioLocked : true
  );
  const [aspectRatio, setAspectRatio] = useState<number>(
    savedSettings?.aspectRatio || 1
  );

  const handleWidthChangeWithAspectRatio = (value: string) => {
    handleWidthChange(value);

    if (aspectRatioLocked && aspectRatio > 0) {
      const numericWidth = parseInt(value) || 32;
      const calculatedHeight = Math.round(numericWidth / aspectRatio);
      const roundedHeight = Math.round(calculatedHeight / 32) * 32;
      setHeight(roundedHeight);
    }
  };

  const handleHeightChangeWithAspectRatio = (value: string) => {
    handleHeightChange(value);

    if (aspectRatioLocked && aspectRatio > 0) {
      const numericHeight = parseInt(value) || 32;
      const calculatedWidth = Math.round(numericHeight * aspectRatio);
      const roundedWidth = Math.round(calculatedWidth / 32) * 32;
      setWidth(roundedWidth);
    }
  };

  const toggleAspectRatioLock = () => {
    const newLockState = !aspectRatioLocked;
    setAspectRatioLocked(newLockState);

    if (newLockState && width > 0 && height > 0) {
      setAspectRatio(width / height);
    }
  };

  // Save settings to localStorage whenever they change
  useEffect(() => {
    const settings = {
      prompt,
      steps,
      seed,
      loras,
      width,
      height,
      aspectRatioLocked,
      aspectRatio
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }, [prompt, steps, seed, loras, width, height, aspectRatioLocked, aspectRatio]);

  // Fetch available LoRAs from ComfyUI (FLUX folder only)
  useEffect(() => {
    const fetchAvailableLoras = async () => {
      if (!comfyUrl) return;

      setIsLoadingLoras(true);
      try {
        const response = await fetch(`${comfyUrl}/object_info/LoraLoaderModelOnly`);
        if (!response.ok) {
          console.error('Failed to fetch LoRA list');
          return;
        }

        const data = await response.json();
        const allLoras = data?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [];

        // Filter to only show LoRAs in FLUX/ folder
        const fluxLoras = allLoras.filter((lora: string) =>
          lora.toUpperCase().startsWith('FLUX/') || lora.toUpperCase().startsWith('FLUX\\')
        );

        setAvailableLoras(fluxLoras);
      } catch (error) {
        console.error('Error fetching LoRAs:', error);
      } finally {
        setIsLoadingLoras(false);
      }
    };

    fetchAvailableLoras();
  }, [comfyUrl]);

  const addLora = () => {
    if (loras.length >= 5) {
      setStatus("⚠️ Maximum 5 LoRAs allowed");
      return;
    }
    const newLora: LoraConfig = {
      id: Math.random().toString(36).slice(2),
      name: "",
      strength: 1.0,
      enabled: true
    };
    setLoras([...loras, newLora]);
  };

  const removeLora = (id: string) => {
    setLoras(loras.filter(lora => lora.id !== id));
  };

  const updateLora = (id: string, field: keyof LoraConfig, value: any) => {
    setLoras(loras.map(lora =>
      lora.id === id ? { ...lora, [field]: value } : lora
    ));
  };

  const randomizeSeed = () => {
    setSeed(Math.floor(Math.random() * 1000000000));
  };

  const generateImage = async () => {
    if (!prompt.trim()) {
      setStatus("❌ Please enter a prompt");
      return;
    }

    if (!comfyUrl) {
      setStatus("❌ ComfyUI URL is not configured");
      return;
    }

    const enabledLoras = loras.filter(l => l.enabled && l.name.trim());

    setIsGenerating(true);
    setStatus("🔨 Building workflow...");
    setResultUrl("");
    setJobId("");

    let databaseJobId: string | null = null;

    try {
      // Build parameters for up to 5 LoRA slots
      const parameters: any = {
        PROMPT: prompt,
        WIDTH: width,
        HEIGHT: height,
        STEPS: steps,
        SEED: seed
      };

      // Fill in LoRA slots (max 5)
      // Use first available LoRA for all slots, but disable unused ones
      const firstLora = availableLoras.length > 0 ? availableLoras[0] : "";

      for (let i = 1; i <= 5; i++) {
        const loraIndex = i - 1;
        if (loraIndex < enabledLoras.length) {
          const lora = enabledLoras[loraIndex];
          parameters[`LORA_${i}_ENABLED`] = true;
          parameters[`LORA_${i}_NAME`] = lora.name;
          parameters[`LORA_${i}_STRENGTH`] = lora.strength;
        } else {
          // Empty slot - use first available LoRA but disabled
          parameters[`LORA_${i}_ENABLED`] = false;
          parameters[`LORA_${i}_NAME`] = firstLora;
          parameters[`LORA_${i}_STRENGTH`] = 1.0;
        }
      }

      const clientId = `flux-lora-${Math.random().toString(36).slice(2)}`;
      const workflowResponse = await apiClient.submitWorkflow(
        'FluxLora',
        parameters,
        comfyUrl,
        clientId
      ) as { success: boolean; prompt_id?: string; error?: string };

      if (!workflowResponse.success || !workflowResponse.prompt_id) {
        throw new Error(workflowResponse.error || 'Failed to submit workflow to ComfyUI');
      }

      const promptId = workflowResponse.prompt_id;
      setJobId(promptId);

      setStatus("💾 Creating job record...");

      const jobCreationResponse = await apiClient.createImageJob({
        comfy_job_id: promptId,
        workflow_name: 'flux-lora',
        comfy_url: comfyUrl,
        input_image_urls: [],
        width,
        height,
        parameters: {
          prompt,
          steps,
          seed,
          loras: enabledLoras
        }
      }) as any;

      if (!jobCreationResponse.success || !jobCreationResponse.image_job?.id) {
        throw new Error('Failed to create job record in database');
      }

      databaseJobId = jobCreationResponse.image_job.id;

      setStatus("⏳ Processing in ComfyUI...");

      // Poll for completion
      const startTime = Date.now();
      const maxWaitTime = 600000; // 10 minutes

      const pollForResult = async (): Promise<void> => {
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWaitTime) {
          throw new Error('Processing timeout after 10 minutes');
        }

        try {
          const historyResponse = await apiClient.getComfyUIHistory(comfyUrl, promptId) as {
            success: boolean;
            history?: any;
            error?: string;
          };

          if (!historyResponse.success) {
            throw new Error(historyResponse.error || 'Failed to get ComfyUI history');
          }

          const history = historyResponse.history;
          const historyEntry = history?.[promptId];

          if (historyEntry?.status?.status_str === "error" || historyEntry?.status?.error) {
            const errorMsg = historyEntry.status?.error?.message ||
                            historyEntry.status?.error ||
                            "Unknown error in ComfyUI";
            throw new Error(`ComfyUI error: ${errorMsg}`);
          }

          if (historyEntry?.status?.status_str === "success" || historyEntry?.outputs) {
            const outputs = historyEntry.outputs;
            let imageInfo = null;

            for (const nodeId in outputs) {
              const nodeOutputs = outputs[nodeId];
              if (nodeOutputs.images && nodeOutputs.images.length > 0) {
                imageInfo = nodeOutputs.images[0];
                break;
              }
            }

            if (imageInfo) {
              const comfyImageUrl = imageInfo.subfolder
                ? `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder)}&type=output`
                : `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(imageInfo.filename)}&type=output`;

              setStatus("💾 Saving image to storage...");

              if (!databaseJobId) {
                throw new Error('Database job ID is missing');
              }

              const completionResult = await apiClient.completeImageJob(databaseJobId, {
                job_id: databaseJobId,
                status: 'completed',
                output_image_urls: [comfyImageUrl]
              }) as any;

              if (!completionResult.success || !completionResult.image_job?.output_image_urls?.[0]) {
                throw new Error('Failed to save image to storage');
              }

              const storedImageUrl = completionResult.image_job.output_image_urls[0];

              setResultUrl(storedImageUrl);
              setStatus("✅ Image generated successfully!");
              setIsGenerating(false);
              return;
            }
          }

          await new Promise(resolve => setTimeout(resolve, 2000));
          return pollForResult();

        } catch (pollError: any) {
          if (pollError.message.includes('timeout') || pollError.message.includes('save image')) {
            throw pollError;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
          return pollForResult();
        }
      };

      await pollForResult();

    } catch (err: any) {
      setStatus(`❌ Error: ${err.message || "Unknown error"}`);
      if (databaseJobId) {
        await apiClient.completeImageJob(databaseJobId, {
          job_id: databaseJobId,
          status: 'error',
          error_message: err.message || 'Unknown error'
        }).catch(() => {});
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              Flux LoRA
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Generate images using Flux with custom LoRA models
            </p>
          </div>

          {/* Prompt Section */}
          <Section title="Prompt">
            <Field>
              <Label>Image Description</Label>
              <textarea
                rows={4}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 resize-vertical"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate..."
              />
            </Field>
          </Section>

          {/* LoRA Configuration */}
          <Section title="LoRA Models">
            <div className="space-y-4">
              {loras.map((lora) => (
                <div key={lora.id} className="flex gap-3 items-start p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={lora.enabled}
                      onChange={(e) => updateLora(lora.id, 'enabled', e.target.checked)}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex-1 space-y-3">
                    <select
                      className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-gray-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200 bg-white"
                      value={lora.name}
                      onChange={(e) => updateLora(lora.id, 'name', e.target.value)}
                      disabled={isLoadingLoras}
                    >
                      <option value="">
                        {isLoadingLoras ? 'Loading LoRAs...' : 'Select a LoRA model'}
                      </option>
                      {availableLoras.map((loraName) => (
                        <option key={loraName} value={loraName}>
                          {loraName}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-3">
                      <Label className="!mb-0 w-20">Strength:</Label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        className="w-24 rounded-xl border-2 border-gray-200 px-3 py-2 text-gray-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200 bg-white"
                        value={lora.strength}
                        onChange={(e) => updateLora(lora.id, 'strength', parseFloat(e.target.value))}
                      />
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        className="flex-1"
                        value={lora.strength}
                        onChange={(e) => updateLora(lora.id, 'strength', parseFloat(e.target.value))}
                      />
                      <span className="text-sm text-gray-600 w-12 text-right">{lora.strength.toFixed(1)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeLora(lora.id)}
                    className="px-3 py-2 rounded-xl bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                  >
                    🗑️
                  </button>
                </div>
              ))}
              <button
                onClick={addLora}
                className="w-full px-4 py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-600 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all duration-200 flex items-center justify-center gap-2 font-medium"
              >
                <span className="text-xl">+</span>
                Add LoRA Model
              </button>
            </div>
          </Section>

          {/* Settings Section */}
          <Section title="Settings">
            <div className="grid md:grid-cols-2 gap-4">
              <Field>
                <Label>Steps</Label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                  value={steps}
                  onChange={(e) => setSteps(parseInt(e.target.value) || 30)}
                />
              </Field>
              <Field>
                <Label>Seed</Label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="flex-1 rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                    value={seed}
                    onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                  />
                  <button
                    onClick={randomizeSeed}
                    className="px-4 py-3 rounded-2xl bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium transition-all duration-200"
                  >
                    🎲
                  </button>
                </div>
              </Field>
            </div>
          </Section>

          {/* Resolution Section */}
          <Section title="Resolution">
            <div className="mb-4 flex items-center gap-3">
              <button
                onClick={toggleAspectRatioLock}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all duration-200 ${
                  aspectRatioLocked
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span className="text-lg">{aspectRatioLocked ? '🔒' : '🔓'}</span>
                <span>Maintain Aspect Ratio</span>
              </button>
              {aspectRatioLocked && aspectRatio > 0 && (
                <span className="text-xs text-gray-500">
                  ({aspectRatio.toFixed(2)}:1)
                </span>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Field>
                <Label>Width (px)</Label>
                <input
                  type="number"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                  value={widthInput}
                  onChange={(e) => handleWidthChangeWithAspectRatio(e.target.value)}
                />
              </Field>
              <Field>
                <Label>Height (px)</Label>
                <input
                  type="number"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                  value={heightInput}
                  onChange={(e) => handleHeightChangeWithAspectRatio(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-xs text-gray-500 mt-3">Auto-corrected to multiples of 32</p>
          </Section>

          {/* Generate Section */}
          <Section title="Generate">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold text-lg shadow-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={generateImage}
                disabled={isGenerating || !prompt.trim()}
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing…
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    Generate
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
              {status && <span className="text-sm">{status}</span>}
            </div>

            {resultUrl && (
              <div className="mt-6 space-y-3">
                <img src={resultUrl} alt="Generated" className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                <div>
                  <button
                    className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = resultUrl;
                      a.download = `flux-lora-${Date.now()}.png`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                    }}
                  >
                    <span>⬇️</span>
                    Download
                  </button>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Right Sidebar - Image Feed */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6 h-[calc(100vh-3rem)]">
            <ImageFeed
              config={{
                useNewJobSystem: true,
                workflowName: 'flux-lora',
                showCompletedOnly: false,
                maxItems: 10,
                showFixButton: false,
                showProgress: false,
                pageContext: "flux-lora"
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
