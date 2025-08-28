import type { WorkflowSettings } from './datasetUtils';

export const createWorkflowFromSettings = (settings: WorkflowSettings, imageBase64: string) => {
  return {
    "4": {
      "inputs": {
        "model": "fancyfeast/llama-joycaption-beta-one-hf-llava",
        "quantization_mode": "nf4",
        "device": "cuda"
      },
      "class_type": "LayerUtility: LoadJoyCaptionBeta1Model",
      "_meta": {
        "title": "LayerUtility: Load JoyCaption Beta One Model (Advance)"
      }
    },
    "5": {
      "inputs": {
        "caption_type": settings.caption_type,
        "caption_length": settings.caption_length,
        "max_new_tokens": settings.max_new_tokens,
        "top_p": settings.top_p,
        "top_k": settings.top_k,
        "temperature": settings.temperature,
        "user_prompt": settings.user_prompt,
        "image": ["40", 0],
        "joycaption_beta1_model": ["4", 0],
        "extra_options": ["6", 0]
      },
      "class_type": "LayerUtility: JoyCaptionBeta1",
      "_meta": {
        "title": "LayerUtility: JoyCaption Beta One (Advance)"
      }
    },
    "6": {
      "inputs": {
        "refer_character_name": settings.refer_character_name,
        "exclude_people_info": settings.exclude_people_info,
        "include_lighting": settings.include_lighting,
        "include_camera_angle": settings.include_camera_angle,
        "include_watermark": settings.include_watermark,
        "include_JPEG_artifacts": settings.include_JPEG_artifacts,
        "include_exif": settings.include_exif,
        "exclude_sexual": settings.exclude_sexual,
        "exclude_image_resolution": settings.exclude_image_resolution,
        "include_aesthetic_quality": settings.include_aesthetic_quality,
        "include_composition_style": settings.include_composition_style,
        "exclude_text": settings.exclude_text,
        "specify_depth_field": settings.specify_depth_field,
        "specify_lighting_sources": settings.specify_lighting_sources,
        "do_not_use_ambiguous_language": settings.do_not_use_ambiguous_language,
        "include_nsfw": settings.include_nsfw,
        "only_describe_most_important_elements": settings.only_describe_most_important_elements,
        "do_not_include_artist_name_or_title": settings.do_not_include_artist_name_or_title,
        "identify_image_orientation": settings.identify_image_orientation,
        "use_vulgar_slang_and_profanity": settings.use_vulgar_slang_and_profanity,
        "do_not_use_polite_euphemisms": settings.do_not_use_polite_euphemisms,
        "include_character_age": settings.include_character_age,
        "include_camera_shot_type": settings.include_camera_shot_type,
        "exclude_mood_feeling": settings.exclude_mood_feeling,
        "include_camera_vantage_height": settings.include_camera_vantage_height,
        "mention_watermark": settings.mention_watermark,
        "avoid_meta_descriptive_phrases": settings.avoid_meta_descriptive_phrases,
        "character_name": settings.character_name
      },
      "class_type": "LayerUtility: JoyCaptionBeta1ExtraOptions",
      "_meta": {
        "title": "Aca marcan lo que quieren en el caption"
      }
    },
    "40": {
      "inputs": {
        "image": imageBase64
      },
      "class_type": "ETN_LoadImageBase64",
      "_meta": {
        "title": "Load Image (Base64)"
      }
    },
    "42": {
      "inputs": {
        "text": ["5", 0]
      },
      "class_type": "ShowText|pysssss",
      "_meta": {
        "title": "Show Text 🐍"
      }
    }
  };
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = error => reject(error);
  });
};

export const processImageWithWorkflow = async (
  file: File, 
  settings: WorkflowSettings, 
  comfyUIUrl: string
): Promise<string> => {
  try {
    const base64 = await fileToBase64(file);
    const workflow = createWorkflowFromSettings(settings, base64);
    
    // Submit workflow to ComfyUI
    const promptResponse = await fetch(`${comfyUIUrl}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: workflow
      })
    });

    if (!promptResponse.ok) {
      throw new Error(`ComfyUI API error: ${promptResponse.status} ${promptResponse.statusText}`);
    }

    const promptResult = await promptResponse.json();
    const promptId = promptResult.prompt_id;

    if (!promptId) {
      throw new Error('No prompt ID received from ComfyUI');
    }

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes with 5 second intervals
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      try {
        const historyResponse = await fetch(`${comfyUIUrl}/history/${promptId}`);
        
        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          
          if (historyData[promptId] && historyData[promptId].status?.completed) {
            // Extract the caption from the outputs
            const outputs = historyData[promptId].outputs;
            
            // Look for the caption in the ShowText node output (node "42")
            if (outputs && outputs["42"] && outputs["42"].text) {
              return outputs["42"].text[0]; // Return the first text output
            }
            
            // Fallback: look for the caption in the JoyCaption node output (node "5")
            if (outputs && outputs["5"] && outputs["5"].text) {
              return outputs["5"].text[0]; // Return the first text output
            }
            
            // Fallback: look for any text output
            for (const nodeId in outputs) {
              const nodeOutput = outputs[nodeId];
              if (nodeOutput.text && nodeOutput.text.length > 0) {
                return nodeOutput.text[0];
              }
            }
            
            throw new Error('No caption found in ComfyUI output');
          }
          
          // Check for errors
          if (historyData[promptId] && historyData[promptId].status?.status_str) {
            const status = historyData[promptId].status.status_str;
            if (status.includes('error') || status.includes('failed')) {
              throw new Error(`ComfyUI processing failed: ${status}`);
            }
          }
        }
      } catch (pollError) {
        console.warn('Error polling ComfyUI status:', pollError);
      }
      
      attempts++;
    }
    
    throw new Error('ComfyUI processing timed out after 5 minutes');
    
  } catch (error) {
    console.error('Error processing image with ComfyUI:', error);
    
    // Fallback to mock caption if ComfyUI fails
    const mockCaption = `[ComfyUI Error] Mock caption for ${file.name}. ComfyUI processing failed: ${error instanceof Error ? error.message : 'Unknown error'}. Character: "${settings.character_name}", Type: "${settings.caption_type}", Length: "${settings.caption_length}".`;
    
    return mockCaption;
  }
};