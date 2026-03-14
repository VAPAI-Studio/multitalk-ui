import { useState, useEffect, useRef } from 'react';
import { apiClient } from '../lib/apiClient';
import type { CustomWorkflow, ExecuteCustomWorkflowPayload } from '../lib/apiClient';
import type { VariableConfig, SectionConfig } from '../lib/builderUtils';
import { DynamicFormRenderer } from '../components/DynamicFormRenderer';
import type { FormValues } from '../components/DynamicFormRenderer';
import ResizableFeedSidebar from '../components/ResizableFeedSidebar';
import { createJob, updateJobToProcessing, completeJob } from '../lib/jobTracking';
import {
  startJobMonitoring,
  uploadMediaToComfy,
  fileToBase64,
  checkComfyUIHealth,
} from '../components/utils';
import { useExecutionBackend } from '../contexts/ExecutionBackendContext';

interface DynamicWorkflowPageProps {
  workflowConfig: CustomWorkflow;
  comfyUrl: string;
}

export default function DynamicWorkflowPage({ workflowConfig, comfyUrl }: DynamicWorkflowPageProps) {
  const { backend } = useExecutionBackend();
  const [formValues, setFormValues] = useState<FormValues>({});
  const [status, setStatus] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [jobId, setJobId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const monitorCleanupRef = useRef<(() => void) | null>(null);

  // Cleanup job monitor on unmount
  useEffect(() => () => { monitorCleanupRef.current?.(); }, []);

  // Cast JSONB arrays from API to typed configs (via unknown to satisfy strict overlap check)
  const variableConfig = (workflowConfig.variable_config ?? []) as unknown as VariableConfig[];
  const sectionConfig = (workflowConfig.section_config ?? []) as unknown as SectionConfig[];

  function handleValueChange(key: string, value: string | number | boolean | File | null) {
    setFormValues(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setStatus('');
    setResultUrl('');
    setJobId('');
    setIsSubmitting(true);

    try {
      // Health check (ComfyUI path only)
      if (backend === 'comfyui') {
        setStatus('Checking ComfyUI...');
        const health = await checkComfyUIHealth(comfyUrl);
        if (!health.available) {
          throw new Error(`${health.error}${health.details ? `. ${health.details}` : ''}`);
        }
      }

      // Pre-process parameters: handle files and resolution pairs
      setStatus('Preparing parameters...');
      const processedParams: Record<string, string | number | boolean | null> = {};

      for (const v of variableConfig) {
        if (v.type === 'resolution') {
          const w = formValues[v.placeholder_key + '_W'] as number | undefined;
          const h = formValues[v.placeholder_key + '_H'] as number | undefined;
          processedParams[v.placeholder_key + '_W'] = w ?? 512;
          processedParams[v.placeholder_key + '_H'] = h ?? 512;
        } else if (['file-image', 'file-audio', 'file-video'].includes(v.type)) {
          const file = formValues[v.placeholder_key] as File | null;
          if (file) {
            if (v.file_mode === 'base64') {
              setStatus(`Encoding ${file.name}...`);
              processedParams[v.placeholder_key] = await fileToBase64(file);
            } else {
              setStatus(`Uploading ${file.name}...`);
              processedParams[v.placeholder_key] = await uploadMediaToComfy(comfyUrl, file);
            }
          } else {
            processedParams[v.placeholder_key] = null;
          }
        } else {
          const raw = formValues[v.placeholder_key];
          processedParams[v.placeholder_key] = (raw as string | number | boolean | null) ?? null;
        }
      }

      const clientId = `dynamic-page-${Math.random().toString(36).slice(2)}`;
      const payload: ExecuteCustomWorkflowPayload = {
        parameters: processedParams,
        base_url: comfyUrl,
        client_id: clientId,
        execution_backend: backend,
      };

      setStatus('Sending to backend...');
      const resp = await apiClient.executeCustomWorkflow(workflowConfig.id, payload);

      if (!resp.success || !resp.prompt_id) {
        throw new Error(resp.error || 'Execution failed — no prompt_id returned');
      }

      const promptId = resp.prompt_id;
      setJobId(promptId);

      // Job tracking — use workflow slug as workflow_type for feed pageContext filtering
      await createJob({
        job_id: promptId,
        comfy_url: comfyUrl,
        workflow_type: workflowConfig.slug,
        width: 0,
        height: 0,
        trim_to_audio: false,
      });
      await updateJobToProcessing(promptId);

      setStatus('Processing...');

      // Start monitoring using startJobMonitoring for both backends.
      // The execute endpoint routes to the correct backend server-side and returns a prompt_id.
      // startRunPodJobMonitoring requires an endpointId not available in the response, so
      // we use startJobMonitoring which polls the job status API uniformly.
      const cleanup = startJobMonitoring(
        promptId,
        comfyUrl,
        async (jobStatus, message, outputInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing...');
          } else if (jobStatus === 'completed' && outputInfo) {
            const url: string =
              outputInfo.result_url ||
              outputInfo.video_url ||
              outputInfo.image_url ||
              (outputInfo.filename
                ? `${comfyUrl}/view?filename=${encodeURIComponent(outputInfo.filename)}&subfolder=${encodeURIComponent(outputInfo.subfolder || '')}&type=${outputInfo.type || 'output'}`
                : '');
            setResultUrl(url);
            setStatus('Generation complete!');
            setIsSubmitting(false);
          } else if (jobStatus === 'error') {
            setStatus(`Error: ${message}`);
            setIsSubmitting(false);
            await completeJob({ job_id: promptId, status: 'failed', error_message: message }).catch(() => {});
          }
        }
      );
      monitorCleanupRef.current = cleanup;
    } catch (err: any) {
      const msg: string = err.message || 'Unknown error';
      setStatus(`Error: ${msg}`);
      setIsSubmitting(false);
      if (jobId) {
        await completeJob({ job_id: jobId, status: 'failed', error_message: msg }).catch(() => {});
      }
    }
  }

  // Feed media type mapping — GenerationFeedConfig supports 'video' | 'image' | 'all'
  const feedMediaType: 'video' | 'image' | 'all' =
    workflowConfig.output_type === 'video' ? 'video' : 'image';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <div className="text-5xl">{workflowConfig.icon}</div>
            <h1
              className={`text-4xl md:text-6xl font-black bg-gradient-to-r ${workflowConfig.gradient} bg-clip-text text-transparent`}
            >
              {workflowConfig.name}
            </h1>
            {workflowConfig.description && (
              <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
                {workflowConfig.description}
              </p>
            )}
          </div>

          {/* Dynamic Form — rendered from variable_config + section_config */}
          <DynamicFormRenderer
            variableConfig={variableConfig}
            sectionConfig={sectionConfig}
            formValues={formValues}
            onValueChange={handleValueChange}
            disabled={isSubmitting}
          />

          {/* Generate Section */}
          <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
              <div
                className={`w-2 h-8 bg-gradient-to-b ${workflowConfig.gradient} rounded-full`}
              />
              Generate
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void handleSubmit()}
                disabled={isSubmitting}
                className={`px-8 py-4 rounded-2xl bg-gradient-to-r ${workflowConfig.gradient} text-white font-bold text-lg shadow-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3`}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <span>Generate</span>
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job: {jobId}</span>}
              {status && <span className="text-sm text-gray-600">{status}</span>}
            </div>

            {/* Result */}
            {resultUrl && (
              <div className="mt-6 space-y-3">
                {workflowConfig.output_type === 'video' && (
                  <video
                    src={resultUrl}
                    controls
                    className="w-full rounded-3xl shadow-2xl border border-gray-200/50"
                  />
                )}
                {workflowConfig.output_type === 'image' && (
                  <img
                    src={resultUrl}
                    alt="Generated result"
                    className="w-full rounded-3xl shadow-2xl border border-gray-200/50"
                  />
                )}
                {workflowConfig.output_type === 'audio' && (
                  <audio src={resultUrl} controls className="w-full" />
                )}
                <button
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = resultUrl;
                    a.download = `result.${
                      workflowConfig.output_type === 'video'
                        ? 'mp4'
                        : workflowConfig.output_type === 'audio'
                        ? 'wav'
                        : 'png'
                    }`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  }}
                  className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
                >
                  <span>Download</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar — Generation Feed filtered by workflow slug */}
        <ResizableFeedSidebar
          config={{
            mediaType: feedMediaType,
            pageContext: workflowConfig.slug,
            showCompletedOnly: false,
            maxItems: 10,
            showFixButton: true,
            showProgress: true,
            comfyUrl,
          }}
          storageKey={`dynamic-workflow-${workflowConfig.slug}`}
        />
      </div>
    </div>
  );
}
