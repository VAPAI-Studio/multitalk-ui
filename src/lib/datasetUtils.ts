import { supabase } from './supabase';

// Types for character caption functionality
export interface Dataset {
  id: string;
  name: string;
  character_trigger: string;
  created_at: string;
  updated_at: string;
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

// Create a new dataset with images and captions
export async function saveDataset(
  name: string,
  characterTrigger: string,
  settings: WorkflowSettings,
  images: ImageWithCaption[]
): Promise<string> {
  try {
    // Create dataset record
    const { data: dataset, error: datasetError } = await supabase
      .from('datasets')
      .insert({
        name,
        character_trigger: characterTrigger,
        settings,
      })
      .select()
      .single();

    if (datasetError) {
      throw new Error(`Failed to create dataset: ${datasetError.message}`);
    }

    if (!dataset) {
      throw new Error('No dataset returned from creation');
    }

    // Upload images to storage and create data entries
    const dataEntries = [];
    
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const fileNumber = i + 1;
      
      try {
        // Get the image file extension
        const originalFileName = image.file.name;
        const lastDotIndex = originalFileName.lastIndexOf('.');
        const extension = lastDotIndex > -1 ? originalFileName.substring(lastDotIndex) : '.png';
        
        // Create unique filename for storage
        const storageFileName = `${dataset.id}/${fileNumber}${extension}`;
        
        // Convert blob URL to actual file
        const response = await fetch(image.url);
        const blob = await response.blob();
        
        // Upload to Supabase storage
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(storageFileName, blob, {
            contentType: image.file.type,
            upsert: false
          });

        if (uploadError) {
          console.error(`Failed to upload image ${fileNumber}:`, uploadError);
          continue;
        }

        // Get public URL for the uploaded image
        const { data: urlData } = supabase.storage
          .from('images')
          .getPublicUrl(storageFileName);

        // Create data entry
        dataEntries.push({
          dataset_id: dataset.id,
          image_url: urlData.publicUrl,
          image_name: `${fileNumber}${extension}`,
          caption: image.caption || ''
        });

      } catch (error) {
        console.error(`Error processing image ${fileNumber}:`, error);
        continue;
      }
    }

    // Insert all data entries
    if (dataEntries.length > 0) {
      const { error: dataError } = await supabase
        .from('data')
        .insert(dataEntries);

      if (dataError) {
        console.error('Failed to insert some data entries:', dataError);
        // Don't throw here, as we want to keep the dataset even if some images fail
      }
    }

    return dataset.id;

  } catch (error) {
    console.error('Error saving dataset:', error);
    throw error;
  }
}

// Load a dataset by ID
export async function loadDataset(datasetId: string): Promise<{
  dataset: Dataset;
  data: DataEntry[];
}> {
  try {
    // Get dataset info
    const { data: dataset, error: datasetError } = await supabase
      .from('datasets')
      .select('*')
      .eq('id', datasetId)
      .single();

    if (datasetError) {
      throw new Error(`Failed to load dataset: ${datasetError.message}`);
    }

    if (!dataset) {
      throw new Error('Dataset not found');
    }

    // Get all data entries for this dataset
    const { data: dataEntries, error: dataError } = await supabase
      .from('data')
      .select('*')
      .eq('dataset_id', datasetId)
      .order('created_at', { ascending: true });

    if (dataError) {
      throw new Error(`Failed to load data entries: ${dataError.message}`);
    }

    return {
      dataset,
      data: dataEntries || []
    };

  } catch (error) {
    console.error('Error loading dataset:', error);
    throw error;
  }
}

// Get all datasets (for selection)
export async function getAllDatasets(): Promise<Dataset[]> {
  try {
    const { data: datasets, error } = await supabase
      .from('datasets')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to load datasets: ${error.message}`);
    }

    return datasets || [];

  } catch (error) {
    console.error('Error loading datasets:', error);
    throw error;
  }
}

// Convert ImageWithCaption to file for loading
export async function urlToFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type });
}