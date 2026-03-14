import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../lib/apiClient';
import type { ParsedNode, CreateWorkflowPayload } from '../lib/apiClient';
import {
  type VariableConfig,
  type SectionConfig,
  type FeatureMetadata,
  type VariableInputType,
  inferFieldType,
  derivePlaceholderKey,
  GRADIENT_PALETTE,
  INPUT_TYPE_OPTIONS,
  extractClassTypes,
  extractModelRefs,
  checkModelPresence,
  parseInstalledPackages,
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
// VariableCard sub-component
// ---------------------------------------------------------------------------

interface VariableCardProps {
  variable: VariableConfig;
  index: number;
  sections: SectionConfig[];
  onUpdate: (id: string, partial: Partial<VariableConfig>) => void;
  onRemove: (id: string) => void;
  onAssignSection: (varId: string, sectionId: string | undefined) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
}

function VariableCard({
  variable,
  index,
  sections,
  onUpdate,
  onRemove,
  onAssignSection,
  onDragStart,
  onDragOver,
  onDrop,
}: VariableCardProps) {
  const isNumber = variable.type === 'number' || variable.type === 'slider';
  const isDropdown = variable.type === 'dropdown';
  const isFile =
    variable.type === 'file-image' ||
    variable.type === 'file-audio' ||
    variable.type === 'file-video';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e); }}
      onDrop={(e) => onDrop(e, index)}
      className="rounded-2xl border-2 border-gray-200 bg-white p-4 cursor-grab active:cursor-grabbing hover:border-gray-300 transition-all duration-150"
    >
      {/* Row 1: drag handle + node source + placeholder badge + remove button */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gray-400 select-none text-lg">⠿</span>
        <span className="text-xs text-gray-500 font-mono truncate">
          Node {variable.node_id} · {variable.input_name}
        </span>
        <span className="ml-auto px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-mono shrink-0">
          {'{{' + variable.placeholder_key + '}}'}
        </span>
        <button
          onClick={() => onRemove(variable.id)}
          className="text-gray-400 hover:text-red-500 transition-colors ml-2 shrink-0 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Row 2: label + type selector */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Label *</label>
          <input
            type="text"
            value={variable.label}
            onChange={(e) => onUpdate(variable.id, { label: e.target.value })}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Input Type</label>
          <select
            value={variable.type}
            onChange={(e) => onUpdate(variable.id, { type: e.target.value as VariableInputType })}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white transition-all"
          >
            {INPUT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 3: placeholder + help text */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Placeholder Text</label>
          <input
            type="text"
            value={variable.placeholder ?? ''}
            onChange={(e) => onUpdate(variable.id, { placeholder: e.target.value })}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Help Text</label>
          <input
            type="text"
            value={variable.help_text ?? ''}
            onChange={(e) => onUpdate(variable.id, { help_text: e.target.value })}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Type-specific: number / slider */}
      {isNumber && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {(['default_value', 'min', 'max', 'step'] as const).map((field) => (
            <div key={field}>
              <label className="block text-xs font-semibold text-gray-600 mb-1 capitalize">
                {field.replace('_', ' ')}
              </label>
              <input
                type="number"
                value={(variable[field] as number | undefined) ?? ''}
                onChange={(e) =>
                  onUpdate(variable.id, {
                    [field]: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      )}

      {/* Type-specific: dropdown */}
      {isDropdown && (
        <div className="mb-3">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Options (one per line)</label>
          <textarea
            rows={3}
            value={(variable.options ?? []).join('\n')}
            onChange={(e) =>
              onUpdate(variable.id, { options: e.target.value.split('\n').filter(Boolean) })
            }
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm resize-y"
          />
        </div>
      )}

      {/* Type-specific: file-* */}
      {isFile && (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Accept Filter</label>
            <input
              type="text"
              value={variable.accept ?? ''}
              placeholder="e.g. image/png,image/jpeg"
              onChange={(e) => onUpdate(variable.id, { accept: e.target.value })}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Max Size (MB)</label>
            <input
              type="number"
              value={variable.max_size_mb ?? ''}
              onChange={(e) =>
                onUpdate(variable.id, {
                  max_size_mb: e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">File Mode</label>
            <select
              value={variable.file_mode ?? 'upload'}
              onChange={(e) =>
                onUpdate(variable.id, { file_mode: e.target.value as 'upload' | 'base64' })
              }
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              <option value="upload">Upload to ComfyUI</option>
              <option value="base64">Base64 encode</option>
            </select>
          </div>
        </div>
      )}

      {/* Bottom row: required checkbox + section assignment */}
      <div className="flex items-center justify-between gap-4 pt-1">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={variable.required ?? false}
            onChange={(e) => onUpdate(variable.id, { required: e.target.checked })}
            className="rounded"
          />
          Required field
        </label>

        {sections.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 font-medium">Section:</label>
            <select
              value={variable.section_id ?? ''}
              onChange={(e) =>
                onAssignSection(variable.id, e.target.value === '' ? undefined : e.target.value)
              }
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-white focus:border-blue-400 transition-all"
            >
              <option value="">No section</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionPanel sub-component
// ---------------------------------------------------------------------------

interface SectionPanelProps {
  section: SectionConfig;
  variables: VariableConfig[];
  allVariables: VariableConfig[];
  sections: SectionConfig[];
  onRenameSection: (id: string, name: string) => void;
  onDeleteSection: (id: string) => void;
  onUpdateVariable: (id: string, partial: Partial<VariableConfig>) => void;
  onRemoveVariable: (id: string) => void;
  onAssignSection: (varId: string, sectionId: string | undefined) => void;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  getGlobalIndex: (varId: string) => number;
}

function SectionPanel({
  section,
  variables,
  sections,
  onRenameSection,
  onDeleteSection,
  onUpdateVariable,
  onRemoveVariable,
  onAssignSection,
  onDragStart,
  onDragOver,
  onDrop,
  getGlobalIndex,
}: SectionPanelProps) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-4 space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="w-1 h-6 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full shrink-0" />
        <input
          type="text"
          value={section.name}
          onChange={(e) => onRenameSection(section.id, e.target.value)}
          className="flex-1 font-bold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none py-0.5 text-sm"
        />
        <button
          onClick={() => onDeleteSection(section.id)}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors shrink-0"
        >
          Remove Section
        </button>
      </div>

      {/* Variables in this section */}
      {variables.map((v) => (
        <VariableCard
          key={v.id}
          variable={v}
          index={getGlobalIndex(v.id)}
          sections={sections}
          onUpdate={onUpdateVariable}
          onRemove={onRemoveVariable}
          onAssignSection={onAssignSection}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      ))}

      {variables.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-2">
          No variables in this section yet. Use the "Section" dropdown on variable cards to assign them here.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VariablesStep sub-component
// ---------------------------------------------------------------------------

interface VariablesStepProps {
  state: BuilderState;
  onUpdate: (partial: Partial<BuilderState>) => void;
  onNext: () => void;
  onBack: () => void;
  setStatus: (s: string) => void;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
}

function VariablesStep({
  state,
  onUpdate,
  onNext,
  onBack,
  setStatus,
  isLoading,
  setIsLoading,
}: VariablesStepProps) {
  const dragIndexRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Suppress unused isDragging warning — used for future visual feedback
  void isDragging;

  // ---------------------------------------------------------------------------
  // Drag-and-drop handlers
  // ---------------------------------------------------------------------------

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    if (fromIndex === null || fromIndex === dropIndex) {
      dragIndexRef.current = null;
      setIsDragging(false);
      return;
    }

    const reordered = [...state.variableConfig];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(dropIndex, 0, moved);
    // Re-assign order values
    const withOrder = reordered.map((v, i) => ({ ...v, order: i }));
    onUpdate({ variableConfig: withOrder });

    dragIndexRef.current = null;
    setIsDragging(false);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setIsDragging(false);
  };

  // ---------------------------------------------------------------------------
  // Variable CRUD handlers
  // ---------------------------------------------------------------------------

  const handleUpdateVariable = (id: string, partial: Partial<VariableConfig>) => {
    onUpdate({
      variableConfig: state.variableConfig.map((v) =>
        v.id === id ? { ...v, ...partial } : v,
      ),
    });
  };

  const handleRemoveVariable = (id: string) => {
    const filtered = state.variableConfig.filter((v) => v.id !== id);
    onUpdate({ variableConfig: filtered.map((v, i) => ({ ...v, order: i })) });
  };

  const handleAssignSection = (varId: string, sectionId: string | undefined) => {
    onUpdate({
      variableConfig: state.variableConfig.map((v) =>
        v.id === varId ? { ...v, section_id: sectionId } : v,
      ),
    });
  };

  // ---------------------------------------------------------------------------
  // Section CRUD handlers
  // ---------------------------------------------------------------------------

  const handleAddSection = () => {
    const newSection: SectionConfig = {
      id: crypto.randomUUID(),
      name: 'New Section',
      order: state.sectionConfig.length,
    };
    onUpdate({ sectionConfig: [...state.sectionConfig, newSection] });
  };

  const handleRenameSection = (id: string, name: string) => {
    onUpdate({
      sectionConfig: state.sectionConfig.map((s) =>
        s.id === id ? { ...s, name } : s,
      ),
    });
  };

  const handleDeleteSection = (id: string) => {
    // Clear section_id from all variables that belonged to this section
    onUpdate({
      sectionConfig: state.sectionConfig.filter((s) => s.id !== id),
      variableConfig: state.variableConfig.map((v) =>
        v.section_id === id ? { ...v, section_id: undefined } : v,
      ),
    });
  };

  // ---------------------------------------------------------------------------
  // Helper: get global index of a variable by id
  // ---------------------------------------------------------------------------

  const getGlobalIndex = (varId: string) =>
    state.variableConfig.findIndex((v) => v.id === varId);

  // ---------------------------------------------------------------------------
  // Save + advance handler
  // ---------------------------------------------------------------------------

  const handleNext = async () => {
    if (!state.workflowId) {
      onNext();
      return;
    }
    setIsLoading(true);
    setStatus('Saving variables…');
    try {
      await apiClient.updateCustomWorkflow(state.workflowId, {
        variable_config: state.variableConfig as unknown as Record<string, unknown>[],
        section_config: state.sectionConfig as unknown as Record<string, unknown>[],
      });
    } catch {
      setStatus('Warning: could not save variables to backend.');
    }
    setIsLoading(false);
    setStatus('');
    onNext();
  };

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const unsectionedVars = state.variableConfig.filter((v) => !v.section_id);

  return (
    <div className="space-y-4" onDragEnd={handleDragEnd}>
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-slate-700 text-white text-xs flex items-center justify-center font-bold shrink-0">
            3
          </span>
          Configure Variables ({state.variableConfig.length})
        </h2>
        <p className="text-xs text-gray-500 mt-1 ml-8">
          Drag cards to reorder. Set labels, types, and section assignments. Click Next to save.
        </p>
      </div>

      {/* Empty state */}
      {state.variableConfig.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
          <p className="text-sm text-gray-500">
            Go back to the Inspect step to add variables from workflow nodes.
          </p>
          <button
            onClick={onBack}
            className="mt-3 px-4 py-2 rounded-xl border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Back to Inspect
          </button>
        </div>
      )}

      {/* Unsectioned variables */}
      {unsectionedVars.length > 0 && (
        <div className="space-y-3">
          {unsectionedVars.map((variable) => (
            <VariableCard
              key={variable.id}
              variable={variable}
              index={getGlobalIndex(variable.id)}
              sections={state.sectionConfig}
              onUpdate={handleUpdateVariable}
              onRemove={handleRemoveVariable}
              onAssignSection={handleAssignSection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            />
          ))}
        </div>
      )}

      {/* Sections */}
      {state.sectionConfig.length > 0 && (
        <div className="space-y-4">
          {state.sectionConfig.map((section) => {
            const sectionVars = state.variableConfig.filter(
              (v) => v.section_id === section.id,
            );
            return (
              <SectionPanel
                key={section.id}
                section={section}
                variables={sectionVars}
                allVariables={state.variableConfig}
                sections={state.sectionConfig}
                onRenameSection={handleRenameSection}
                onDeleteSection={handleDeleteSection}
                onUpdateVariable={handleUpdateVariable}
                onRemoveVariable={handleRemoveVariable}
                onAssignSection={handleAssignSection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                getGlobalIndex={getGlobalIndex}
              />
            );
          })}
        </div>
      )}

      {/* Add Section button */}
      {state.variableConfig.length > 0 && (
        <button
          onClick={handleAddSection}
          className="w-full rounded-2xl border-2 border-dashed border-gray-200 py-3 text-sm text-gray-500 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/30 transition-all"
        >
          + Add Section
        </button>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => void handleNext()}
          disabled={isLoading}
          className="px-6 py-2.5 rounded-xl bg-slate-700 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving…
            </>
          ) : (
            'Next: Dependencies'
          )}
        </button>
        <p className="text-xs text-gray-400">
          {state.variableConfig.length} variable{state.variableConfig.length !== 1 ? 's' : ''}
          {state.sectionConfig.length > 0 &&
            ` · ${state.sectionConfig.length} section${state.sectionConfig.length !== 1 ? 's' : ''}`}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DependenciesStep helpers
// ---------------------------------------------------------------------------

function buildInstallBlock(pkgName: string, repo: string, hasRequirements: boolean): string {
  let block = `\n# Added by Workflow Builder\nRUN cd /comfyui/custom_nodes && \\\n    git clone ${repo} ${pkgName}`;
  if (hasRequirements) {
    block += `\nRUN cd /comfyui/custom_nodes/${pkgName} && \\\n    pip install -r requirements.txt --no-cache-dir`;
  }
  return block + '\n';
}

// ---------------------------------------------------------------------------
// DependenciesStep sub-component
// ---------------------------------------------------------------------------

interface DependenciesStepProps {
  state: BuilderState;
  onUpdate: (partial: Partial<BuilderState>) => void;
  onNext: () => void;
  onBack: () => void;
  setStatus: (s: string) => void;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
}

type DepStatus = { pkgName: string; repo: string; hasRequirements: boolean; installed: boolean };
type MdlStatus = { filename: string; present: boolean };

function DependenciesStep({
  state,
  onUpdate,
  onNext,
  onBack,
  setStatus,
  isLoading,
  setIsLoading,
}: DependenciesStepProps) {
  const [depStatuses, setDepStatuses] = useState<DepStatus[]>([]);
  const [modelStatuses, setModelStatuses] = useState<MdlStatus[]>([]);
  const [dockerfileContent, setDockerfileContent] = useState('');
  const [dockerfileSha, setDockerfileSha] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [addingPkg, setAddingPkg] = useState<string | null>(null);

  const loadChecks = useCallback(async () => {
    setIsLoading(true);
    setStatus('Loading dependency and model data...');
    try {
      // 1. Fetch registry, manifest, dockerfile in parallel
      const [registry, manifest, dockerfile] = await Promise.all([
        apiClient.getNodeRegistry(),
        apiClient.getModelManifest(),
        apiClient.getDockerfileContent(),
      ]);

      // 2. Build class_type → package map
      const classTypeToPackage: Record<string, { pkgName: string; repo: string; hasRequirements: boolean }> = {};
      for (const [pkgName, pkg] of Object.entries(registry.packages)) {
        for (const ct of pkg.class_types) {
          classTypeToPackage[ct] = { pkgName, repo: pkg.repo, hasRequirements: pkg.has_requirements };
        }
      }

      // 3. Extract class_types from parsed nodes
      const classTypes = extractClassTypes(state.parsedNodes);

      // 4. Get installed packages from dockerfile
      const installed = parseInstalledPackages(dockerfile.content);

      // 5. Build dep statuses (skip class_types not in registry — those are ComfyUI built-ins)
      const seenPkgs = new Set<string>();
      const deps: DepStatus[] = [];
      for (const ct of classTypes) {
        const pkgInfo = classTypeToPackage[ct];
        if (!pkgInfo || seenPkgs.has(pkgInfo.pkgName)) continue;
        seenPkgs.add(pkgInfo.pkgName);
        deps.push({
          pkgName: pkgInfo.pkgName,
          repo: pkgInfo.repo,
          hasRequirements: pkgInfo.hasRequirements,
          installed: installed.has(pkgInfo.pkgName),
        });
      }

      // 6. Extract model refs and check against manifest
      const modelRefs = extractModelRefs(state.parsedNodes);
      const modelChecks = checkModelPresence(modelRefs, manifest);

      // 7. Update state
      setDockerfileContent(dockerfile.content);
      setDockerfileSha(dockerfile.sha);
      onUpdate({ dockerfileSha: dockerfile.sha });
      setDepStatuses(deps);
      setModelStatuses(modelChecks);
      setLoaded(true);
      setStatus('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setStatus(`Failed to load checks: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.parsedNodes]);

  // Load on mount and when parsedNodes change
  useEffect(() => {
    void loadChecks();
  }, [loadChecks]);

  const addPackageToDockerfile = async (dep: DepStatus) => {
    setAddingPkg(dep.pkgName);
    try {
      const installBlock = buildInstallBlock(dep.pkgName, dep.repo, dep.hasRequirements);
      const newContent = dockerfileContent + installBlock;
      const result = await apiClient.saveDockerfileContent({
        content: newContent,
        sha: dockerfileSha,
        commit_message: `builder: add ${dep.pkgName} custom node`,
        trigger_deploy: false,
      });
      if (!result.success) throw new Error('Save failed');

      // CRITICAL: re-fetch to get updated SHA after commit
      const refreshed = await apiClient.getDockerfileContent();
      setDockerfileContent(refreshed.content);
      setDockerfileSha(refreshed.sha);
      onUpdate({ dockerfileSha: refreshed.sha });

      // Mark as installed in local state
      setDepStatuses(prev => prev.map(d =>
        d.pkgName === dep.pkgName ? { ...d, installed: true } : d,
      ));
      setStatus(`Added ${dep.pkgName} to Dockerfile.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setStatus(`Failed to add ${dep.pkgName}: ${msg}`);
    } finally {
      setAddingPkg(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Dependencies panel */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
          Custom Node Packages
          {!loaded && <span className="text-sm text-gray-400">(loading...)</span>}
        </h3>
        {loaded && depStatuses.length === 0 && (
          <p className="text-sm text-gray-500">No custom node packages detected (workflow uses only built-in ComfyUI nodes).</p>
        )}
        {depStatuses.map(dep => (
          <div key={dep.pkgName} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${dep.installed ? 'bg-green-400' : 'bg-orange-400'}`} />
            <span className="flex-1 font-mono text-sm text-gray-800">{dep.pkgName}</span>
            <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${dep.installed ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'}`}>
              {dep.installed ? 'Installed' : 'Missing'}
            </span>
            {!dep.installed && (
              <button
                onClick={() => void addPackageToDockerfile(dep)}
                disabled={addingPkg === dep.pkgName}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {addingPkg === dep.pkgName ? 'Adding...' : 'Add to Dockerfile'}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Models panel */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h3 className="font-bold text-gray-900 mb-4">
          Model Files on Network Volume
        </h3>
        {loaded && modelStatuses.length === 0 && (
          <p className="text-sm text-gray-500">No model files detected in this workflow (no inputs matching model field names or extensions).</p>
        )}
        {modelStatuses.map(model => (
          <div key={model.filename} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${model.present ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="flex-1 font-mono text-sm text-gray-800 break-all">{model.filename}</span>
            <span className={`text-xs px-2 py-0.5 rounded-lg font-medium flex-shrink-0 ${model.present ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {model.present ? 'On Volume' : 'Missing'}
            </span>
          </div>
        ))}
        {loaded && modelStatuses.some(m => !m.present) && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-4">
            Some models are not detected on the RunPod network volume. Use the Infrastructure file browser to upload them before publishing.
          </p>
        )}
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
          onClick={onNext}
          disabled={isLoading}
          className="px-6 py-2.5 rounded-xl bg-slate-700 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Next: Feature Metadata
        </button>
        <button
          onClick={() => void loadChecks()}
          disabled={isLoading}
          className="px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-600 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
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

  // Suppress unused import warning for GRADIENT_PALETTE
  // (it will be used in Plan 06 metadata step)
  void GRADIENT_PALETTE;

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
        <VariablesStep
          state={state}
          onUpdate={(p) => setState((s) => ({ ...s, ...p }))}
          onNext={() => void goToStep('dependencies')}
          onBack={() => void goToStep('inspect')}
          setStatus={setStatus}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        />
      )}

      {step === 'dependencies' && (
        <DependenciesStep
          state={state}
          onUpdate={(p) => setState((s) => ({ ...s, ...p }))}
          onNext={() => void goToStep('metadata')}
          onBack={() => void goToStep('variables')}
          setStatus={setStatus}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        />
      )}

      {step === 'metadata' && (
        <div className="rounded-2xl border border-gray-200 p-6 text-gray-400 text-center">
          Metadata step — implemented in Plan 06
        </div>
      )}
    </div>
  );
}
