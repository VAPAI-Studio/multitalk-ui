import { apiClient } from './apiClient';

// Types for character caption functionality
export interface Dataset {
  id: string;
  name: string;
  character_trigger: string;
  created_at: string;
  updated_at: string;
  image_count?: number;
  settings: {
    caption_type: string;
    caption_length: string;
    max_new_tokens: number;
    temperature: number;
    character_name: string;
    refer_character_name: boolean;
    exclude_people_info: boolean;
    include_lighting: boolean;
    include_camera_angle: boolean;
    include_watermark: boolean;
    include_JPEG_artifacts: boolean;
    include_exif: boolean;
    exclude_sexual: boolean;
    exclude_image_resolution: boolean;
    include_aesthetic_quality: boolean;
    include_composition_style: boolean;
    exclude_text: boolean;
    specify_depth_field: boolean;
    specify_lighting_sources: boolean;
    do_not_use_ambiguous_language: boolean;
    include_nsfw: boolean;
    only_describe_most_important_elements: boolean;
    do_not_include_artist_name_or_title: boolean;
    identify_image_orientation: boolean;
    use_vulgar_slang_and_profanity: boolean;
    do_not_use_polite_euphemisms: boolean;
    include_character_age: boolean;
    include_camera_shot_type: boolean;
    exclude_mood_feeling: boolean;
    include_camera_vantage_height: boolean;
    mention_watermark: boolean;
    avoid_meta_descriptive_phrases: boolean;
    top_p: number;
    top_k: number;
    user_prompt: string;
  };
}

export interface DataEntry {
  id: string;
  dataset_id: string;
  image_url: string;
  image_name: string;
  caption: string;
  created_at: string;
}

export interface ImageWithCaption {
  url: string;
  file: File;
  caption?: string;
}

export type WorkflowSettings = Dataset['settings'];

// API Response interfaces for datasets (removed unused interfaces)

// Create a new dataset with images and captions via API
export async function saveDataset(
  name: string,
  characterTrigger: string,
  settings: WorkflowSettings,
  images: ImageWithCaption[]
): Promise<string> {
  try {
    // Create FormData for multipart upload
    const formData = new FormData();
    formData.append('name', name);
    formData.append('character_trigger', characterTrigger);
    formData.append('settings', JSON.stringify(settings));
    
    // Prepare captions array
    const captions: string[] = [];
    
    // Add images and their captions
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      
      // Convert blob URL to actual file if needed
      if (image.url.startsWith('blob:')) {
        const response = await fetch(image.url);
        const blob = await response.blob();
        const file = new File([blob], image.file.name, { type: image.file.type });
        formData.append('images', file);
      } else {
        formData.append('images', image.file);
      }
      
      captions.push(image.caption || '');
    }
    
    // Add captions as JSON string
    if (captions.length > 0) {
      formData.append('captions', JSON.stringify(captions));
    }

    const response = await apiClient.createDataset(formData) as any;
    
    // Handle different possible response structures
    if (response.success && response.dataset) {
      return response.dataset.id;
    } else if (response.id) {
      // Direct response with dataset ID
      return response.id;
    } else if (response.dataset_id) {
      // Response with dataset_id field
      return response.dataset_id;
    } else {
      throw new Error(response.error || response.message || 'Failed to create dataset');
    }

  } catch (error: any) {
    console.error('Error saving dataset:', error);
    // Provide more user-friendly error message
    if (error.message && error.message.includes('API request failed')) {
      throw new Error(`Backend API error: ${error.message}`);
    }
    throw error;
  }
}

// Load a dataset by ID via API
export async function loadDataset(datasetId: string): Promise<{
  dataset: Dataset;
  data: DataEntry[];
}> {
  try {
    const response = await apiClient.loadDataset(datasetId) as any;
    
    // Handle different possible response structures
    if (response.success && response.dataset) {
      return {
        dataset: response.dataset,
        data: response.data || []
      };
    } else if (response.dataset) {
      // Direct dataset response
      return {
        dataset: response.dataset,
        data: response.data || response.images || []
      };
    } else if (response.id) {
      // Response is the dataset itself
      return {
        dataset: response,
        data: response.data || response.images || []
      };
    } else {
      throw new Error(response.error || response.message || 'Dataset not found');
    }

  } catch (error: any) {
    console.error('Error loading dataset:', error);
    if (error.message && error.message.includes('API request failed')) {
      throw new Error(`Backend API error: ${error.message}`);
    }
    throw error;
  }
}

// Get all datasets (for selection) via API
export async function getAllDatasets(): Promise<Dataset[]> {
  try {
    const response = await apiClient.getAllDatasets() as any;
    
    // Handle different possible response structures
    if (response.success) {
      return response.datasets || [];
    } else if (Array.isArray(response)) {
      // Direct array response
      return response;
    } else if (response.datasets) {
      return response.datasets;
    } else {
      throw new Error(response.error || response.message || 'Failed to load datasets');
    }

  } catch (error: any) {
    console.error('Error loading datasets:', error);
    if (error.message && error.message.includes('API request failed')) {
      throw new Error(`Backend API error: ${error.message}`);
    }
    throw error;
  }
}

// Convert ImageWithCaption to file for loading
export async function urlToFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type });
}