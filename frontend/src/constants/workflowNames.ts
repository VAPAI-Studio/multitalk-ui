/**
 * Shared workflow display name mapping
 * Maps workflow_name values (used in database) to human-readable labels
 */

export const WORKFLOW_DISPLAY_NAMES: Record<string, string> = {
  // Video workflows
  'lipsync-one': 'Lipsync 1 Person',
  'lipsync-multi': 'Lipsync Multi Person',
  'video-lipsync': 'Video Lipsync',
  'wan-i2v': 'WAN I2V',
  'wan-move': 'WAN Move',
  'ltx2-i2v': 'LTX2 I2V',
  'legacy': 'Legacy',

  // Image workflows
  'image-grid': 'Image Grid',
  'style-transfer': 'Style Transfer',
  'create-image': 'Create Image',
  'flux-lora': 'Flux LoRA',
  'nanobanana-upscale': '4K Upscale',
  'image-edit': 'Image Edit',
  'camera-angle': 'Camera Angle',
  'multi-camera-angle': 'Multi Camera Angle',
  'character-caption': 'Character Caption',
}

// Video workflow names for type categorization
export const VIDEO_WORKFLOW_NAMES = [
  'lipsync-one',
  'lipsync-multi',
  'video-lipsync',
  'wan-i2v',
  'wan-move',
  'ltx2-i2v',
  'legacy',
]

// Image workflow names for type categorization
export const IMAGE_WORKFLOW_NAMES = [
  'image-grid',
  'style-transfer',
  'create-image',
  'flux-lora',
  'nanobanana-upscale',
  'image-edit',
  'camera-angle',
  'multi-camera-angle',
  'character-caption',
]

/**
 * Get human-readable display name for a workflow
 * Falls back to the workflow name itself if not found in mapping
 */
export function getWorkflowDisplayName(workflowName: string): string {
  return WORKFLOW_DISPLAY_NAMES[workflowName] || workflowName
}

/**
 * Get the media type for a workflow
 */
export function getWorkflowMediaType(workflowName: string): 'video' | 'image' {
  return VIDEO_WORKFLOW_NAMES.includes(workflowName) ? 'video' : 'image'
}
