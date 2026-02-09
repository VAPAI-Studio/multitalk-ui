// Studio and App Configuration
// Defines the structure for organizing apps into studio groups

export interface AppConfig {
  id: string;
  title: string;
  icon: string;
  gradient: string;
  description: string;
  features: string[];
  fullWidth?: boolean; // For standalone apps that should span full width on homepage
}

export interface StudioConfig {
  id: string;
  title: string;
  icon: string;
  gradient: string;
  description: string;
  apps: AppConfig[];
  comingSoon?: boolean;
}

// All available apps organized by studios
export const studios: StudioConfig[] = [
  {
    id: 'lipsync-studio',
    title: 'Lipsync Studio',
    icon: '🎤',
    gradient: 'from-blue-500 to-purple-600',
    description: 'Generate realistic talking videos from images or sync audio to existing videos.',
    apps: [
      {
        id: 'lipsync-one-person',
        title: '1 Person',
        icon: '👤',
        gradient: 'from-blue-500 to-purple-600',
        description: 'Generate realistic talking videos from a single person image with custom audio.',
        features: ['Single avatar lipsync', 'MultiTalk & InfiniteTalk modes', 'Model: Multitalk / Infinite Talk with WAN 2.1']
      },
      {
        id: 'lipsync-multi-person',
        title: 'Multi Person',
        icon: '👥',
        gradient: 'from-emerald-500 to-teal-600',
        description: 'Create conversations between multiple people with synchronized audio and video using mask-based tracking.',
        features: ['Multiple masks per person', 'Timeline audio sync', 'Model: Multitalk with WAN 2.1']
      },
      {
        id: 'video-lipsync',
        title: 'Video Lipsync',
        icon: '🎬',
        gradient: 'from-green-500 to-blue-600',
        description: 'Add perfect lip-synchronization to existing videos with new audio tracks.',
        features: ['Video-to-video lipsync', 'Timeline sync controls', 'Model: Infinite Talk with WAN 2.1']
      }
    ]
  },
  {
    id: 'image-studio',
    title: 'Image Studio',
    icon: '🖼️',
    gradient: 'from-purple-500 to-pink-600',
    description: 'Edit, create, and transform images with AI-powered tools.',
    apps: [
      {
        id: 'nano-banana',
        title: 'Nano Banana',
        icon: '🍌',
        gradient: 'from-purple-500 to-pink-600',
        description: 'Edit and enhance images using AI-powered editing with natural language instructions.',
        features: ['AI image editing', 'Natural language prompts', 'Model: OpenRouter AI']
      },
      {
        id: 'camera-angle',
        title: 'Camera Angle',
        icon: '📷',
        gradient: 'from-blue-500 to-indigo-600',
        description: 'Generate new camera angles and perspectives from a reference image using 3D controls.',
        features: ['3D angle selector', 'Azimuth & elevation control', 'Model: Qwen Multiple Angles']
      },
      {
        id: 'style-transfer',
        title: 'Style Transfer',
        icon: '🎨',
        gradient: 'from-orange-500 to-red-600',
        description: 'Transfer artistic styles between images using AI. Combine subject and style reference images to create unique artistic combinations.',
        features: ['Dual image input', 'Artistic style transfer', 'Model: Flux with USO Style Reference']
      },
      {
        id: 'create-image',
        title: 'Create Image',
        icon: '✨',
        gradient: 'from-indigo-500 to-purple-600',
        description: 'Generate images using Flux or Qwen with custom LoRA models. Add multiple LoRAs with adjustable weights for precise control.',
        features: ['Multiple LoRA support', 'Flux & Qwen models', 'Adjustable weights per LoRA']
      },
      {
        id: 'image-grid',
        title: 'Image Grid',
        icon: '🖼️',
        gradient: 'from-teal-500 to-cyan-600',
        description: 'Generate a 3×3 grid of unique image variations from a single reference. Perfect for product photography and creative exploration.',
        features: ['9 unique angles', 'Subject-aware prompts', 'Model: Gemini Pro Image']
      }
    ]
  },
  {
    id: 'video-studio',
    title: 'Video Studio',
    icon: '🎬',
    gradient: 'from-cyan-500 to-blue-600',
    description: 'Transform images into captivating videos with AI-powered generation.',
    apps: [
      {
        id: 'wan-i2v',
        title: 'WAN I2V',
        icon: '🎬',
        gradient: 'from-purple-600 to-pink-600',
        description: 'Transform your images into captivating videos with AI-powered image-to-video generation.',
        features: ['Image to video generation', 'Custom prompts', 'Model: WAN I2V']
      },
      {
        id: 'wan-move',
        title: 'WAN Move',
        icon: '🎯',
        gradient: 'from-cyan-500 to-blue-600',
        description: 'Animate objects in your images with custom motion paths. Draw paths to guide movement and add static anchors for stabilization.',
        features: ['Custom motion paths', 'Static anchors', 'Animation preview', 'Model: WAN Move']
      },
      {
        id: 'ltx2-i2v',
        title: 'LTX2 I2V',
        icon: '🎥',
        gradient: 'from-cyan-500 to-blue-600',
        description: 'Transform your images into high-quality videos with the LTX2 model. Adjustable strength and duration for precise control.',
        features: ['Image to video generation', 'Adjustable strength', 'Duration presets (3s, 5s, 10s)', 'Model: LTX2']
      }
    ]
  },
  {
    id: 'audio-studio',
    title: 'Audio Studio',
    icon: '🎵',
    gradient: 'from-green-500 to-emerald-600',
    description: 'Process and separate audio tracks with AI-powered tools.',
    apps: [
      {
        id: 'audio-stem-separator',
        title: 'Stem Separator',
        icon: '🎵',
        gradient: 'from-green-500 to-emerald-600',
        description: 'Separate any audio track into individual stems: vocals, drums, bass, and other instruments using AI-powered audio separation.',
        features: ['Vocal isolation', 'Drum & bass extraction', 'Download as ZIP or separate files', 'Model: Open Unmix']
      }
    ]
  },
  {
    id: 'text-studio',
    title: 'Text Studio',
    icon: '📝',
    gradient: 'from-slate-500 to-gray-600',
    description: 'AI text generation and processing tools.',
    apps: [],
    comingSoon: true
  },
  {
    id: 'lora-studio',
    title: 'LoRA Studio',
    icon: '🧠',
    gradient: 'from-amber-500 to-orange-600',
    description: 'Train and use custom AI models with LoRA technology.',
    apps: [
      {
        id: 'character-caption',
        title: 'Character Caption',
        icon: '📝',
        gradient: 'from-indigo-500 to-purple-600',
        description: 'Generate detailed captions for character images to create training datasets for LoRA models.',
        features: ['AI caption generation', 'Batch processing', 'Model: JoyCaption Beta 2']
      },
      {
        id: 'lora-trainer',
        title: 'LoRA Trainer',
        icon: '🧠',
        gradient: 'from-amber-500 to-orange-600',
        description: 'Train your own custom QWEN Image LoRA models with your datasets. Perfect for creating consistent characters, styles, or objects.',
        features: ['Custom LoRA training', 'Dataset-based', 'Advanced parameters', 'Model: QWEN Image via Musubi Tuner']
      }
    ]
  }
];

// Standalone apps (not part of any studio)
export const standaloneApps: AppConfig[] = [
  {
    id: 'history',
    title: 'History',
    icon: '📋',
    gradient: 'from-gray-600 to-slate-700',
    description: 'View and manage all your AI generations in one place. Browse videos, images, and style transfers with real-time updates.',
    features: ['All generations in one view', 'Filter by type', 'Real-time progress tracking'],
    fullWidth: true
  }
];

// localStorage key for tracking last used apps
const LAST_USED_KEY = 'vapai-last-used-apps';

/**
 * Get the last used app for a specific studio
 */
export function getLastUsedApp(studioId: string): string | null {
  try {
    const stored = localStorage.getItem(LAST_USED_KEY);
    if (!stored) return null;
    const map = JSON.parse(stored) as Record<string, string>;
    return map[studioId] || null;
  } catch {
    return null;
  }
}

/**
 * Set the last used app for a specific studio
 */
export function setLastUsedApp(studioId: string, appId: string): void {
  try {
    const stored = localStorage.getItem(LAST_USED_KEY);
    const map = stored ? (JSON.parse(stored) as Record<string, string>) : {};
    map[studioId] = appId;
    localStorage.setItem(LAST_USED_KEY, JSON.stringify(map));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Sort apps by last used (last used app first)
 */
export function sortAppsByLastUsed(studio: StudioConfig): AppConfig[] {
  const lastUsed = getLastUsedApp(studio.id);
  if (!lastUsed || studio.apps.length <= 1) return studio.apps;

  return [...studio.apps].sort((a, b) => {
    if (a.id === lastUsed) return -1;
    if (b.id === lastUsed) return 1;
    return 0;
  });
}

/**
 * Get a studio by ID
 */
export function getStudioById(studioId: string): StudioConfig | undefined {
  return studios.find(s => s.id === studioId);
}

/**
 * Get the studio that contains a specific app
 */
export function getStudioByAppId(appId: string): StudioConfig | undefined {
  return studios.find(s => s.apps.some(a => a.id === appId));
}

/**
 * Get all app IDs across all studios
 */
export function getAllAppIds(): string[] {
  const studioAppIds = studios.flatMap(s => s.apps.map(a => a.id));
  const standaloneIds = standaloneApps.map(a => a.id);
  return [...studioAppIds, ...standaloneIds];
}

/**
 * Get all studio IDs
 */
export function getAllStudioIds(): string[] {
  return studios.map(s => s.id);
}

// Type for valid page navigation
export type StudioPageType =
  | 'home'
  | 'lipsync-studio'
  | 'image-studio'
  | 'video-studio'
  | 'audio-studio'
  | 'text-studio'
  | 'lora-studio'
  | 'history'
  | 'profile-settings';
