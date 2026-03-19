import type { ParsedNode, ModelManifest } from './apiClient';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export type VariableInputType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'slider'
  | 'file-image'
  | 'file-audio'
  | 'file-video'
  | 'dropdown'
  | 'toggle'
  | 'resolution';

export interface VariableConfig {
  id: string;
  node_id: string;
  input_name: string;
  placeholder_key: string;
  label: string;
  placeholder?: string;
  help_text?: string;
  type: VariableInputType;
  default_value?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  required?: boolean;
  accept?: string;
  max_size_mb?: number;
  file_mode?: 'upload' | 'base64';
  section_id?: string;
  order: number;
}

export interface SectionConfig {
  id: string;
  name: string;
  order: number;
}

export interface FeatureMetadata {
  name: string;
  slug: string;
  description: string;
  output_type: 'image' | 'video' | 'audio';
  studio: string;
  icon: string;
  gradient: string;
  is_published: boolean;
}

export interface ModelStatus {
  filename: string;
  present: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MODEL_FIELDS = new Set([
  'ckpt_name',
  'model_name',
  'unet_name',
  'vae_name',
  'lora_name',
  'clip_name',
  'clip_name1',
  'clip_name2',
  'model',
  'lora',
  'audio_model',
  'name',
  'gemma_path',
]);

export const MODEL_EXTENSIONS = new Set([
  '.safetensors',
  '.pth',
  '.ckpt',
  '.bin',
  '.onnx',
]);

export const GRADIENT_PALETTE = [
  { label: 'Blue to Purple', value: 'from-blue-500 to-purple-600' },
  { label: 'Purple to Pink', value: 'from-purple-500 to-pink-600' },
  { label: 'Green to Teal', value: 'from-green-500 to-teal-600' },
  { label: 'Orange to Red', value: 'from-orange-500 to-red-600' },
  { label: 'Cyan to Blue', value: 'from-cyan-500 to-blue-600' },
  { label: 'Amber to Orange', value: 'from-amber-500 to-orange-600' },
  { label: 'Slate to Gray', value: 'from-slate-500 to-gray-700' },
  { label: 'Emerald to Teal', value: 'from-emerald-500 to-teal-600' },
  { label: 'Indigo to Purple', value: 'from-indigo-500 to-purple-600' },
];

export const INPUT_TYPE_OPTIONS: Array<{ value: VariableInputType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number', label: 'Number' },
  { value: 'slider', label: 'Slider' },
  { value: 'file-image', label: 'File (Image)' },
  { value: 'file-audio', label: 'File (Audio)' },
  { value: 'file-video', label: 'File (Video)' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'toggle', label: 'Toggle' },
  { value: 'resolution', label: 'Resolution' },
];

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const MODEL_EXT_LIST = ['.safetensors', '.pth', '.ckpt', '.bin'];
const IMAGE_EXT_LIST = ['.png', '.jpg', '.jpeg', '.webp'];
const VIDEO_EXT_LIST = ['.mp4', '.mov', '.webm'];
const AUDIO_EXT_LIST = ['.wav', '.mp3', '.flac'];

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Infer the VariableInputType from a ComfyUI node input value.
 */
export function inferFieldType(value: unknown): VariableInputType {
  if (typeof value === 'boolean') return 'toggle';

  // Check array of strings before any string check
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return 'dropdown';
  }

  if (typeof value === 'string') {
    const ext = getExtension(value);
    if (MODEL_EXT_LIST.includes(ext)) return 'text';
    if (IMAGE_EXT_LIST.includes(ext)) return 'file-image';
    if (VIDEO_EXT_LIST.includes(ext)) return 'file-video';
    if (AUDIO_EXT_LIST.includes(ext)) return 'file-audio';
    return 'text';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'number' : 'slider';
  }

  return 'text';
}

/**
 * Return unique class_type values from a parsed node array, preserving
 * first-seen order.
 */
export function extractClassTypes(nodes: ParsedNode[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const node of nodes) {
    if (!seen.has(node.class_type)) {
      seen.add(node.class_type);
      result.push(node.class_type);
    }
  }
  return result;
}

/**
 * Extract custom node package names from Dockerfile content.
 * Matches any occurrence of `custom_nodes/<name>` in the text.
 */
export function parseInstalledPackages(dockerfileContent: string): Set<string> {
  const regex = /custom_nodes\/([^\s\\]+)/g;
  const result = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(dockerfileContent)) !== null) {
    result.add(match[1]);
  }
  return result;
}

/**
 * Extract model filenames from configurable_inputs of parsed nodes.
 * Checks input.name against MODEL_FIELDS and input.value extension against
 * MODEL_EXTENSIONS. Skips placeholder values (starting with '{{').
 */
export function extractModelRefs(nodes: ParsedNode[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const node of nodes) {
    for (const input of node.configurable_inputs) {
      const value = input.value;
      if (typeof value !== 'string') continue;
      if (value.startsWith('{{')) continue;

      const ext = getExtension(value);
      const isModelField = MODEL_FIELDS.has(input.name);
      const isModelExt = MODEL_EXTENSIONS.has(ext);

      if (isModelField || isModelExt) {
        if (!seen.has(value)) {
          seen.add(value);
          result.push(value);
        }
      }
    }
  }

  return result;
}

/**
 * Cross-reference model file refs against a manifest by basename.
 */
export function checkModelPresence(refs: string[], manifest: ModelManifest): ModelStatus[] {
  // Build a set of basenames present in the manifest
  const presentBasenames = new Set(
    manifest.models.map((m) => {
      const parts = m.filename.split('/');
      return parts[parts.length - 1];
    }),
  );

  return refs.map((ref) => {
    const parts = ref.split('/');
    const basename = parts[parts.length - 1];
    return { filename: ref, present: presentBasenames.has(basename) };
  });
}

/**
 * Generate a URL-safe slug from a feature name.
 * Mirrors the backend generate_slug() function exactly.
 *
 * Steps:
 *   1. Lowercase
 *   2. Strip non-alphanumeric, non-space, non-hyphen characters
 *   3. Replace runs of spaces/hyphens with single '-'
 *   4. Trim leading/trailing '-'
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derive the placeholder key for a workflow template parameter.
 * Format: `{nodeId}_{INPUT_NAME}` where INPUT_NAME is uppercased with
 * non-alphanumeric characters replaced by '_'.
 */
export function derivePlaceholderKey(nodeId: string, inputName: string): string {
  const sanitised = inputName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `${nodeId}_${sanitised}`;
}
