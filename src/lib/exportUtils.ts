import JSZip from 'jszip';
import type { ImageWithCaption } from './datasetUtils';

export const exportAsZip = async (images: ImageWithCaption[]) => {
  const zip = new JSZip();
  
  // Create outputs folder
  const outputsFolder = zip.folder('outputs');
  
  if (!outputsFolder) {
    throw new Error('Failed to create outputs folder in ZIP');
  }
  
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const fileNumber = i + 1; // Start from 1, not 0
    
    try {
      // Get the image blob
      const response = await fetch(image.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const blob = await response.blob();
      
      // Get the original file extension
      const originalFileName = image.file.name;
      const lastDotIndex = originalFileName.lastIndexOf('.');
      const extension = lastDotIndex > -1 ? originalFileName.substring(lastDotIndex) : '.png';
      
      // Create numbered filenames
      const imageFileName = `${fileNumber}${extension}`;
      const captionFileName = `${fileNumber}.txt`;
      
      // Add files to outputs folder
      outputsFolder.file(imageFileName, blob);
      outputsFolder.file(captionFileName, image.caption || '');
      
    } catch (error) {
      console.error(`Error processing image ${fileNumber}:`, error);
      // Continue with other images even if one fails
    }
  }
  
  try {
    const content = await zip.generateAsync({ type: 'blob' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'captions_dataset.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error('Error generating or downloading ZIP:', error);
    throw new Error('Failed to create ZIP file');
  }
};