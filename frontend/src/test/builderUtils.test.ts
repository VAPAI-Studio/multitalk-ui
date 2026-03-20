import { describe, it, expect } from 'vitest';
import {
  inferFieldType,
  extractClassTypes,
  parseInstalledPackages,
  extractModelRefs,
  checkModelPresence,
  generateSlug,
  derivePlaceholderKey,
} from '../lib/builderUtils';
import type { ParsedNode, ModelManifest } from '../lib/apiClient';

// Helper to build a ParsedNode for tests
const makeNode = (
  nodeId: string,
  classType: string,
  inputs: Array<{ name: string; value: unknown }>,
): ParsedNode => ({
  node_id: nodeId,
  class_type: classType,
  inputs: inputs.map((i) => ({ ...i, is_link: false })),
  configurable_inputs: inputs.map((i) => ({ ...i, is_link: false })),
});

// Helper to build a ModelManifest for tests
const makeManifest = (filenames: string[]): ModelManifest => ({
  _schema_version: '1.0',
  models: filenames.map((f) => ({
    filename: f,
    path: 'test/',
    source: null,
    size_gb: 1,
    type: 'test',
    used_by: [],
  })),
});

// -------------------------------------------------------------------
// inferFieldType
// -------------------------------------------------------------------
describe('inferFieldType', () => {
  it('returns toggle for boolean true', () => {
    expect(inferFieldType(true)).toBe('toggle');
  });

  it('returns toggle for boolean false', () => {
    expect(inferFieldType(false)).toBe('toggle');
  });

  it('returns dropdown for array of strings', () => {
    expect(inferFieldType(['euler', 'dpm_2'])).toBe('dropdown');
  });

  it('returns text for model file (.safetensors)', () => {
    expect(inferFieldType('model.safetensors')).toBe('text');
  });

  it('returns file-image for image file (.png)', () => {
    expect(inferFieldType('frame.png')).toBe('file-image');
  });

  it('returns file-video for video file (.mp4)', () => {
    expect(inferFieldType('clip.mp4')).toBe('file-video');
  });

  it('returns file-audio for audio file (.wav)', () => {
    expect(inferFieldType('voice.wav')).toBe('file-audio');
  });

  it('returns text for plain string', () => {
    expect(inferFieldType('hello world')).toBe('text');
  });

  it('returns number for integer', () => {
    expect(inferFieldType(20)).toBe('number');
  });

  it('returns slider for float', () => {
    expect(inferFieldType(8.5)).toBe('slider');
  });

  it('returns text for null (fallback)', () => {
    expect(inferFieldType(null)).toBe('text');
  });
});

// -------------------------------------------------------------------
// extractClassTypes
// -------------------------------------------------------------------
describe('extractClassTypes', () => {
  it('returns unique class_types from node array', () => {
    const nodes = [
      makeNode('1', 'KSampler', []),
      makeNode('2', 'CLIPTextEncode', []),
      makeNode('3', 'KSampler', []),
    ];
    const result = extractClassTypes(nodes);
    expect(result).toEqual(['KSampler', 'CLIPTextEncode']);
  });

  it('returns empty array for empty input', () => {
    expect(extractClassTypes([])).toEqual([]);
  });
});

// -------------------------------------------------------------------
// parseInstalledPackages
// -------------------------------------------------------------------
describe('parseInstalledPackages', () => {
  it('extracts package name from git clone line', () => {
    const dockerfile = 'RUN git clone https://github.com/foo custom_nodes/MyNode';
    const result = parseInstalledPackages(dockerfile);
    expect(result.has('MyNode')).toBe(true);
  });

  it('returns empty Set when no custom_nodes found', () => {
    const result = parseInstalledPackages('no custom nodes here');
    expect(result.size).toBe(0);
  });

  it('handles multiple custom_nodes lines', () => {
    const dockerfile = [
      'RUN git clone https://github.com/a custom_nodes/NodeA',
      'RUN git clone https://github.com/b custom_nodes/NodeB',
    ].join('\n');
    const result = parseInstalledPackages(dockerfile);
    expect(result.has('NodeA')).toBe(true);
    expect(result.has('NodeB')).toBe(true);
    expect(result.size).toBe(2);
  });
});

// -------------------------------------------------------------------
// extractModelRefs
// -------------------------------------------------------------------
describe('extractModelRefs', () => {
  it('returns model filename for ckpt_name input', () => {
    const nodes = [makeNode('1', 'CheckpointLoaderSimple', [{ name: 'ckpt_name', value: 'model.safetensors' }])];
    expect(extractModelRefs(nodes)).toEqual(['model.safetensors']);
  });

  it('skips placeholder values', () => {
    const nodes = [makeNode('1', 'CheckpointLoaderSimple', [{ name: 'ckpt_name', value: '{{CKPT_NAME}}' }])];
    expect(extractModelRefs(nodes)).toEqual([]);
  });

  it('returns empty array when no model refs exist', () => {
    const nodes = [makeNode('1', 'CLIPTextEncode', [{ name: 'text', value: 'a cat' }])];
    expect(extractModelRefs(nodes)).toEqual([]);
  });
});

// -------------------------------------------------------------------
// checkModelPresence
// -------------------------------------------------------------------
describe('checkModelPresence', () => {
  it('returns present:true when model exists in manifest', () => {
    const manifest = makeManifest(['model.safetensors']);
    const result = checkModelPresence(['model.safetensors'], manifest);
    expect(result).toEqual([{ filename: 'model.safetensors', present: true }]);
  });

  it('returns present:false when model missing from manifest', () => {
    const manifest = makeManifest([]);
    const result = checkModelPresence(['missing.safetensors'], manifest);
    expect(result).toEqual([{ filename: 'missing.safetensors', present: false }]);
  });

  it('matches by basename only (ignores path prefix)', () => {
    const manifest = makeManifest(['model.safetensors']);
    const result = checkModelPresence(['checkpoints/model.safetensors'], manifest);
    expect(result).toEqual([{ filename: 'checkpoints/model.safetensors', present: true }]);
  });
});

// -------------------------------------------------------------------
// generateSlug
// -------------------------------------------------------------------
describe('generateSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(generateSlug('My Feature Name!')).toBe('my-feature-name');
  });

  it('collapses multiple spaces into single hyphen', () => {
    expect(generateSlug('Multiple   Spaces')).toBe('multiple-spaces');
  });

  it('trims leading/trailing hyphens', () => {
    expect(generateSlug('  --leading-trailing--  ')).toBe('leading-trailing');
  });
});

// -------------------------------------------------------------------
// derivePlaceholderKey
// -------------------------------------------------------------------
describe('derivePlaceholderKey', () => {
  it('combines node_id with uppercased input_name', () => {
    expect(derivePlaceholderKey('14', 'ckpt_name')).toBe('14_CKPT_NAME');
  });

  it('works with simple numeric node id', () => {
    expect(derivePlaceholderKey('3', 'steps')).toBe('3_STEPS');
  });
});
