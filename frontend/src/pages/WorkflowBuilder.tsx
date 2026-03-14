import { useState, useRef, useCallback } from 'react';
import { apiClient } from '../lib/apiClient';
import type { ParsedNode, CreateWorkflowPayload } from '../lib/apiClient';
import {
  type VariableConfig,
  type SectionConfig,
  type FeatureMetadata,
  inferFieldType,
  derivePlaceholderKey,
  GRADIENT_PALETTE,
  INPUT_TYPE_OPTIONS,
} from '../lib/builderUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BuilderStep = 'upload' | 'inspect' | 'variables' | 'dependencies' | 'metadata';

interface BuilderState {
  workflowFile: File | null;
  workflowJson: Record<string, unknown> | null;
  parsedNodes: ParsedNode[];
  workflowId: string | null;
  variableConfig: VariableConfig[];
  sectionConfig: SectionConfig[];
  metadata: FeatureMetadata;
  dockerfileSha: string;
}

const INITIAL_METADATA: FeatureMetadata = {
  name: '',
  slug: '',
  description: '',
  output_type: 'image',
  studio: '',
  icon: '✨',
  gradient: 'from-blue-500 to-purple-600',
  is_published: false,
};

const INITIAL_STATE: BuilderState = {
  workflowFile: null,
  workflowJson: null,
  parsedNodes: [],
  workflowId: null,
  variableConfig: [],
  sectionConfig: [],
  metadata: INITIAL_METADATA,
  dockerfileSha: '',
};

const STEP_LABELS: Record<BuilderStep, string> = {
  upload: 'Upload',
  inspect: 'Inspect',
  variables: 'Variables',
  dependencies: 'Dependencies',
  metadata: 'Metadata',
};
const STEPS: BuilderStep[] = ['upload', 'inspect', 'variables', 'dependencies', 'metadata'];

// ---------------------------------------------------------------------------
// StepIndicator sub-component
// ---------------------------------------------------------------------------

function StepIndicator({
  steps,
  current,
  onStepClick,
}: {
  steps: BuilderStep[];
  current: BuilderStep;
  onStepClick: (s: BuilderStep) => void;
}) {
  const currentIndex = steps.indexOf(current);
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center">
          <button
            onClick={() => i < currentIndex && onStepClick(s)}
            disabled={i > currentIndex}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
              s === current
                ? 'bg-slate-700 text-white shadow-md'
                : i < currentIndex
                  ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {i + 1}. {STEP_LABELS[s]}
          </button>
          {i < steps.length - 1 && <div className="w-6 h-px bg-gray-300 mx-1" />}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UploadStep sub-component
// ---------------------------------------------------------------------------

interface UploadStepProps {
  state: BuilderState;
  onUpdate: (partial: Partial<BuilderState>) => void;
  onNext: () => void;
  setStatus: (s: string) => void;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
}

function UploadStep({
  state,
  onUpdate,
  onNext,
  setStatus,
  isLoading,
  setIsLoading,
}: UploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleFileChange = useCallback(
    (file: File) => {
      setLocalError('');
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const json = JSON.parse(text) as Record<string, unknown>;
          onUpdate({ workflowFile: file, workflowJson: json });
        } catch {
          setLocalError('Invalid JSON: could not parse file. Please upload a valid ComfyUI workflow JSON.');
          onUpdate({ workflowFile: file, workflowJson: null });
        }
      };
      reader.readAsText(file);
    },
    [onUpdate],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileChange(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileChange(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleParse = async () => {
    if (!state.workflowJson) {
      setLocalError('No workflow loaded. Please upload a JSON file first.');
      return;
    }
    setIsLoading(true);
    setStatus('Parsing workflow…');
    setLocalError('');
    try {
      const parseRes = await apiClient.parseWorkflow(state.workflowJson);
      if (!parseRes.success) {
        const errMsg = parseRes.error ?? 'Unknown parse error';
        setLocalError(
          parseRes.format === 'ui'
            ? `Workflow appears to be in ComfyUI UI format. Please export using "Save (API Format)" in ComfyUI. Error: ${errMsg}`
            : `Parse error: ${errMsg}`,
        );
        setIsLoading(false);
        setStatus('');
        return;
      }

      setStatus('Creating workflow record…');
      const createPayload: CreateWorkflowPayload = {
        name: state.workflowFile?.name.replace(/\.json$/i, '') ?? 'New Workflow',
        workflow_json: state.workflowJson,
        output_type: 'image',
      };
      const createRes = await apiClient.createCustomWorkflow(createPayload);
      if (!createRes.success) {
        setLocalError(`Failed to create workflow: ${createRes.error ?? 'Unknown error'}`);
        setIsLoading(false);
        setStatus('');
        return;
      }

      onUpdate({
        parsedNodes: parseRes.nodes,
        workflowId: createRes.workflow?.id ?? null,
      });
      setStatus('');
      setIsLoading(false);
      onNext();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(`Error: ${msg}`);
      setIsLoading(false);
      setStatus('');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-slate-700 text-white text-xs flex items-center justify-center font-bold">1</span>
          Upload Workflow JSON
        </h2>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors ${
            dragOver
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleInputChange}
            className="sr-only"
          />
          <div className="text-4xl mb-3">📄</div>
          <p className="text-sm font-medium text-gray-700">
            {dragOver ? 'Drop JSON file here' : 'Drag & drop or click to upload'}
          </p>
          <p className="text-xs text-gray-500 mt-1">ComfyUI API-format workflow JSON</p>
        </div>

        {/* File info */}
        {state.workflowFile && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <span className="text-green-600 text-lg">✓</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-800 truncate">{state.workflowFile.name}</p>
              <p className="text-xs text-green-600">{formatFileSize(state.workflowFile.size)}</p>
            </div>
            {state.workflowJson && (
              <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-md">
                {Object.keys(state.workflowJson).length} nodes
              </span>
            )}
          </div>
        )}

        {/* Error display */}
        {localError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {localError}
          </div>
        )}

        {/* Parse button */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleParse}
            disabled={!state.workflowJson || isLoading}
            className="px-6 py-2.5 rounded-xl bg-slate-700 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Parsing…
              </>
            ) : (
              'Parse Workflow'
            )}
          </button>
          <p className="text-xs text-gray-500">
            Parses nodes, creates a draft record, then opens the Inspect step.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectStep sub-component
// ---------------------------------------------------------------------------

interface InspectStepProps {
  state: BuilderState;
  onUpdate: (partial: Partial<BuilderState>) => void;
  onNext: () => void;
  onBack: () => void;
  comfyUrl: string;
  setStatus: (s: string) => void;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
}

async function fetchObjectInfo(
  comfyUrl: string,
  classType: string,
): Promise<Record<string, unknown[]>> {
  try {
    const response = await fetch(`${comfyUrl}/object_info/${classType}`, {
      credentials: 'omit',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return {};
    const data = await response.json() as Record<string, { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }>;
    const nodeInfo = data[classType];
    if (!nodeInfo?.input) return {};
    return { ...(nodeInfo.input.required ?? {}), ...(nodeInfo.input.optional ?? {}) };
  } catch {
    return {};
  }
}

function InspectStep({
  state,
  onUpdate,
  onNext,
  onBack,
  comfyUrl,
  setStatus,
  isLoading,
  setIsLoading,
}: InspectStepProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [enrichedInputMeta, setEnrichedInputMeta] = useState<Map<string, Record<string, unknown[]>>>(
    new Map(),
  );

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const isPromoted = (nodeId: string, inputName: string) =>
    state.variableConfig.some((v) => v.node_id === nodeId && v.input_name === inputName);

  const promoteInput = (nodeId: string, inputName: string, value: unknown) => {
    if (isPromoted(nodeId, inputName)) return;

    const objectInfoData = enrichedInputMeta.get('');
    const classType = state.parsedNodes.find((n) => n.node_id === nodeId)?.class_type ?? '';
    const nodeObjectInfo = enrichedInputMeta.get(classType);
    const inputDef = nodeObjectInfo?.[inputName];

    let defaultValue: string | number | boolean | undefined;
    let min: number | undefined;
    let max: number | undefined;
    let step: number | undefined;
    let options: string[] | undefined;

    if (inputDef && Array.isArray(inputDef) && inputDef.length >= 2) {
      // /object_info format: [type_or_array, { default?, min?, max?, step? }]
      const meta = inputDef[1] as Record<string, unknown>;
      if (meta && typeof meta === 'object') {
        if (meta.default !== undefined) defaultValue = meta.default as string | number | boolean;
        if (typeof meta.min === 'number') min = meta.min;
        if (typeof meta.max === 'number') max = meta.max;
        if (typeof meta.step === 'number') step = meta.step;
      }
      // COMBO: first element is array of strings
      if (Array.isArray(inputDef[0]) && (inputDef[0] as unknown[]).every((v) => typeof v === 'string')) {
        options = inputDef[0] as string[];
      }
    }

    // Suppress "objectInfoData is unused" warning
    void objectInfoData;

    const newVar: VariableConfig = {
      id: crypto.randomUUID(),
      node_id: nodeId,
      input_name: inputName,
      placeholder_key: derivePlaceholderKey(nodeId, inputName),
      label: inputName,
      type: inferFieldType(value),
      order: state.variableConfig.length,
      ...(defaultValue !== undefined ? { default_value: defaultValue } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(step !== undefined ? { step } : {}),
      ...(options !== undefined ? { options } : {}),
    };

    onUpdate({ variableConfig: [...state.variableConfig, newVar] });
  };

  const removeVariable = (id: string) => {
    onUpdate({ variableConfig: state.variableConfig.filter((v) => v.id !== id) });
  };

  const handleEnrich = async () => {
    if (!comfyUrl) {
      setStatus('Set a ComfyUI URL in the header to enable enrichment.');
      return;
    }
    setIsLoading(true);
    setStatus('Fetching node metadata from ComfyUI...');

    const uniqueClassTypes = [...new Set(state.parsedNodes.map((n) => n.class_type))];
    const results = await Promise.allSettled(
      uniqueClassTypes.map(async (ct) => ({
        classType: ct,
        data: await fetchObjectInfo(comfyUrl, ct),
      })),
    );

    const newMap = new Map<string, Record<string, unknown[]>>();
    let enrichedCount = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        newMap.set(result.value.classType, result.value.data);
        if (Object.keys(result.value.data).length > 0) enrichedCount++;
      }
    }

    setEnrichedInputMeta(newMap);
    setIsLoading(false);
    setStatus(`Enriched ${enrichedCount} node types from ComfyUI.`);
  };

  const getTypeBadgeColor = (type: string) => {
    const colors: Record<string, string> = {
      text: 'bg-gray-100 text-gray-700',
      textarea: 'bg-gray-100 text-gray-700',
      number: 'bg-blue-100 text-blue-700',
      slider: 'bg-blue-100 text-blue-700',
      'file-image': 'bg-green-100 text-green-700',
      'file-audio': 'bg-purple-100 text-purple-700',
      'file-video': 'bg-orange-100 text-orange-700',
      dropdown: 'bg-yellow-100 text-yellow-700',
      toggle: 'bg-pink-100 text-pink-700',
      resolution: 'bg-cyan-100 text-cyan-700',
    };
    return colors[type] ?? 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="space-y-4">
      {/* Two-column layout */}
      <div className="grid grid-cols-5 gap-4">
        {/* Left: Node Inspector ~60% */}
        <div className="col-span-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">
              Node Inspector — {state.parsedNodes.length} nodes
            </h2>
            <div className="flex items-center gap-2">
              {!comfyUrl && (
                <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                  Set ComfyUI URL to enable enrichment
                </span>
              )}
              <button
                onClick={handleEnrich}
                disabled={!comfyUrl || isLoading}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? 'Enriching…' : 'Enrich from ComfyUI'}
              </button>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[600px] divide-y divide-gray-50">
            {state.parsedNodes.map((node) => {
              const isExpanded = expandedNodes.has(node.node_id);
              return (
                <div key={node.node_id} className="group">
                  {/* Node header */}
                  <button
                    onClick={() => toggleNode(node.node_id)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                      ▶
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-500">{node.node_id}</span>
                        <span className="text-sm font-medium text-gray-900 truncate">{node.class_type}</span>
                        {node.title && (
                          <span className="text-xs text-gray-500 truncate">— {node.title}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">
                      {node.configurable_inputs.length} inputs
                    </span>
                  </button>

                  {/* Expanded inputs */}
                  {isExpanded && (
                    <div className="px-5 pb-3 bg-gray-50/60">
                      {node.configurable_inputs.length === 0 ? (
                        <p className="text-xs text-gray-400 italic py-2">No configurable inputs</p>
                      ) : (
                        <div className="space-y-1.5 mt-1">
                          {node.configurable_inputs.map((input) => {
                            const promoted = isPromoted(node.node_id, input.name);
                            return (
                              <div
                                key={input.name}
                                className="flex items-center gap-3 rounded-lg px-3 py-2 bg-white border border-gray-100"
                              >
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs font-semibold text-gray-800">{input.name}</span>
                                  <span className="text-xs text-gray-400 ml-2 truncate">
                                    {Array.isArray(input.value)
                                      ? `[${(input.value as unknown[]).slice(0, 3).join(', ')}${(input.value as unknown[]).length > 3 ? '…' : ''}]`
                                      : String(input.value).slice(0, 40)}
                                  </span>
                                </div>
                                <button
                                  onClick={() => promoteInput(node.node_id, input.name, input.value)}
                                  disabled={promoted}
                                  title={promoted ? 'Already added as variable' : 'Add as variable'}
                                  className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold transition-colors shrink-0 ${
                                    promoted
                                      ? 'bg-green-100 text-green-600 cursor-default'
                                      : 'bg-blue-100 text-blue-600 hover:bg-blue-200 cursor-pointer'
                                  }`}
                                >
                                  {promoted ? '✓' : '+'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Promoted Variables ~40% */}
        <div className="col-span-2 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">
              Variables ({state.variableConfig.length})
            </h2>
          </div>

          <div className="overflow-y-auto max-h-[600px] p-4">
            {state.variableConfig.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-xs text-gray-400 leading-relaxed">
                  Click the + button next to any node input to add it as a user-facing variable.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {state.variableConfig.map((variable) => (
                  <div
                    key={variable.id}
                    className="flex items-start gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{variable.label}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                          {`{{${variable.placeholder_key}}}`}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded font-medium ${getTypeBadgeColor(variable.type)}`}
                        >
                          {variable.type}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        Node {variable.node_id} · {variable.input_name}
                      </p>
                    </div>
                    <button
                      onClick={() => removeVariable(variable.id)}
                      title="Remove variable"
                      className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => {
            onUpdate({ variableConfig: state.variableConfig });
            onNext();
          }}
          className="px-6 py-2.5 rounded-xl bg-slate-700 text-white font-semibold text-sm hover:bg-slate-800 transition-colors"
        >
          Next: Configure Variables
        </button>
        <p className="text-xs text-gray-400">
          {state.variableConfig.length} variable{state.variableConfig.length !== 1 ? 's' : ''} promoted
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main WorkflowBuilder component
// ---------------------------------------------------------------------------

interface Props {
  comfyUrl: string;
}

export default function WorkflowBuilder({ comfyUrl }: Props) {
  const [step, setStep] = useState<BuilderStep>('upload');
  const [state, setState] = useState<BuilderState>(INITIAL_STATE);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const saveToBackend = async () => {
    if (!state.workflowId) return;
    try {
      await apiClient.updateCustomWorkflow(state.workflowId, {
        variable_config: state.variableConfig as unknown as Record<string, unknown>[],
        section_config: state.sectionConfig as unknown as Record<string, unknown>[],
        name: state.metadata.name || undefined,
        description: state.metadata.description || undefined,
        output_type: state.metadata.output_type,
        studio: state.metadata.studio || undefined,
        icon: state.metadata.icon,
        gradient: state.metadata.gradient,
      });
    } catch {
      setStatus('Warning: could not auto-save progress to backend.');
    }
  };

  const goToStep = async (next: BuilderStep) => {
    await saveToBackend();
    setStep(next);
  };

  // Suppress unused import warning for GRADIENT_PALETTE and INPUT_TYPE_OPTIONS
  // (they will be used in Plans 04-06 step implementations)
  void GRADIENT_PALETTE;
  void INPUT_TYPE_OPTIONS;

  return (
    <div className="space-y-6">
      <StepIndicator steps={STEPS} current={step} onStepClick={(s) => void goToStep(s)} />

      {status && (
        <div className="text-sm px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
          {status}
        </div>
      )}

      {step === 'upload' && (
        <UploadStep
          state={state}
          onUpdate={(p) => setState((s) => ({ ...s, ...p }))}
          onNext={() => void goToStep('inspect')}
          setStatus={setStatus}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        />
      )}

      {step === 'inspect' && (
        <InspectStep
          state={state}
          onUpdate={(p) => setState((s) => ({ ...s, ...p }))}
          onNext={() => void goToStep('variables')}
          onBack={() => void goToStep('upload')}
          comfyUrl={comfyUrl}
          setStatus={setStatus}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        />
      )}

      {step === 'variables' && (
        <div className="rounded-2xl border border-gray-200 p-6 text-gray-400 text-center">
          Variables step — implemented in Plan 04
        </div>
      )}

      {step === 'dependencies' && (
        <div className="rounded-2xl border border-gray-200 p-6 text-gray-400 text-center">
          Dependencies step — implemented in Plan 05
        </div>
      )}

      {step === 'metadata' && (
        <div className="rounded-2xl border border-gray-200 p-6 text-gray-400 text-center">
          Metadata step — implemented in Plan 06
        </div>
      )}
    </div>
  );
}
