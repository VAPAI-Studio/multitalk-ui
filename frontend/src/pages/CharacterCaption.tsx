import { useState } from 'react';
import { saveDataset, loadDataset, getAllDatasets, type WorkflowSettings, type ImageWithCaption as DatasetImage, type Dataset } from '../lib/datasetUtils';
import { processImageWithWorkflow } from '../lib/workflowUtils';
import { exportAsZip } from '../lib/exportUtils';

interface ImageWithCaption {
  id: string;
  file: File;
  url: string;
  caption: string;
  isProcessing: boolean;
}

interface Props {
  comfyUrl: string;
}

const defaultSettings: WorkflowSettings = {
  caption_type: "Descriptive",
  caption_length: "any",
  max_new_tokens: 512,
  top_p: 0.9,
  top_k: 0,
  temperature: 0.6,
  user_prompt: "",
  character_name: "ch4racterl0r4",
  refer_character_name: true,
  exclude_people_info: true,
  include_lighting: true,
  include_camera_angle: true,
  include_watermark: false,
  include_JPEG_artifacts: false,
  include_exif: false,
  exclude_sexual: true,
  exclude_image_resolution: false,
  include_aesthetic_quality: true,
  include_composition_style: true,
  exclude_text: true,
  specify_depth_field: false,
  specify_lighting_sources: false,
  do_not_use_ambiguous_language: true,
  include_nsfw: false,
  only_describe_most_important_elements: false,
  do_not_include_artist_name_or_title: true,
  identify_image_orientation: false,
  use_vulgar_slang_and_profanity: false,
  do_not_use_polite_euphemisms: false,
  include_character_age: true,
  include_camera_shot_type: false,
  exclude_mood_feeling: true,
  include_camera_vantage_height: false,
  mention_watermark: false,
  avoid_meta_descriptive_phrases: true
};

const CoolToggle = ({ 
  checked, 
  onChange, 
  label, 
  disabled = false 
}: { 
  checked: boolean; 
  onChange: (checked: boolean) => void; 
  label: string; 
  disabled?: boolean;
}) => {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
      <span className={`text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>
        {label}
      </span>
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />
        <div
          onClick={() => !disabled && onChange(!checked)}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out cursor-pointer
            ${disabled 
              ? 'bg-gray-300 cursor-not-allowed' 
              : checked 
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 shadow-lg shadow-blue-500/25' 
                : 'bg-gray-300 hover:bg-gray-400'
            }
          `}
        >
          <span
            className={`
              inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ease-in-out shadow-sm
              ${checked ? 'translate-x-6' : 'translate-x-1'}
              ${!disabled && checked ? 'shadow-md' : ''}
            `}
          />
          {checked && !disabled && (
            <div className="absolute inset-0 rounded-full animate-pulse bg-gradient-to-r from-blue-400 to-purple-500 opacity-30" />
          )}
        </div>
      </div>
    </div>
  );
};

export default function CharacterCaption({ comfyUrl }: Props) {
  const [settings, setSettings] = useState<WorkflowSettings>(defaultSettings);
  const [images, setImages] = useState<ImageWithCaption[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [runOnUpload, setRunOnUpload] = useState(false);
  const [showMoreSettings, setShowMoreSettings] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [showDatasetModal, setShowDatasetModal] = useState(false);
  const [datasetModalMode, setDatasetModalMode] = useState<'save' | 'load'>('save');
  const [datasetName, setDatasetName] = useState('');
  const [datasets, setDatasets] = useState<Dataset[]>([]);

  const handleInputChange = (key: keyof WorkflowSettings, value: any) => {
    setSettings({
      ...settings,
      [key]: value
    });
  };

  // Define which options go in the "More Options" section
  const moreOptionsKeys = [
    'avoid_meta_descriptive_phrases',
    'mention_watermark',
    'include_camera_vantage_height',
    'do_not_use_polite_euphemisms',
    'use_vulgar_slang_and_profanity',
    'identify_image_orientation',
    'do_not_include_artist_name_or_title',
    'include_nsfw',
    'exclude_image_resolution',
    'include_exif',
    'include_JPEG_artifacts'
  ];

  const handleImagesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList) return;

    const files = Array.from(fileList).filter(file => file.type.startsWith('image/'));
    
    const newImages: ImageWithCaption[] = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      url: URL.createObjectURL(file),
      caption: '',
      isProcessing: runOnUpload
    }));

    setImages(prev => [...prev, ...newImages]);
    
    if (runOnUpload) {
      for (const image of newImages) {
        try {
          const caption = await processImageWithWorkflow(image.file, settings, comfyUrl);
          setImages(prev => prev.map(img => 
            img.id === image.id 
              ? { ...img, caption, isProcessing: false }
              : img
          ));
        } catch (error) {
          console.error('Error processing image:', error);
          setImages(prev => prev.map(img => 
            img.id === image.id 
              ? { ...img, caption: 'Error generating caption', isProcessing: false }
              : img
          ));
        }
      }
    }
  };

  const handleCaptionEdit = (id: string, caption: string) => {
    setImages(prev => prev.map(img => 
      img.id === id ? { ...img, caption } : img
    ));
  };

  const handleExport = async () => {
    if (images.length === 0) return;
    
    setIsProcessing(true);
    try {
      const imagesForExport: DatasetImage[] = images.map(img => ({
        url: img.url,
        file: img.file,
        caption: img.caption
      }));
      
      await exportAsZip(imagesForExport);
    } catch (error) {
      console.error('Error exporting:', error);
      alert('Error exporting files');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearAll = () => {
    images.forEach(image => URL.revokeObjectURL(image.url));
    setImages([]);
  };

  const handleRerunImage = async (imageId: string) => {
    const image = images.find(img => img.id === imageId);
    if (!image || image.isProcessing) return;

    setImages(prev => prev.map(img => 
      img.id === imageId ? { ...img, isProcessing: true, caption: '' } : img
    ));

    try {
      const caption = await processImageWithWorkflow(image.file, settings, comfyUrl);
      setImages(prev => prev.map(img => 
        img.id === imageId 
          ? { ...img, caption, isProcessing: false }
          : img
      ));
    } catch (error) {
      console.error('Error reprocessing image:', error);
      setImages(prev => prev.map(img => 
        img.id === imageId 
          ? { ...img, caption: 'Error generating caption', isProcessing: false }
          : img
      ));
    }
  };

  const handleProcessAll = async () => {
    if (images.length === 0) return;

    setImages(prev => prev.map(img => ({ ...img, isProcessing: true, caption: '' })));

    for (const image of images) {
      try {
        const caption = await processImageWithWorkflow(image.file, settings, comfyUrl);
        setImages(prev => prev.map(img => 
          img.id === image.id 
            ? { ...img, caption, isProcessing: false }
            : img
        ));
      } catch (error) {
        console.error('Error processing image:', error);
        setImages(prev => prev.map(img => 
          img.id === image.id 
            ? { ...img, caption: 'Error generating caption', isProcessing: false }
            : img
        ));
      }
    }
  };

  const handleSaveDataset = async () => {
    if (images.length === 0 || !datasetName.trim()) {
      alert('Please provide a dataset name and ensure there are images to save');
      return;
    }

    try {
      setIsProcessing(true);
      const imagesForDataset: DatasetImage[] = images.map(img => ({
        url: img.url,
        file: img.file,
        caption: img.caption
      }));
      
      const datasetId = await saveDataset(datasetName, settings.character_name, settings, imagesForDataset);
      alert(`Dataset saved successfully! ID: ${datasetId}`);
      setShowDatasetModal(false);
      setDatasetName('');
    } catch (error) {
      console.error('Error saving dataset:', error);
      alert(`Failed to save dataset: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadDataset = async (datasetId: string) => {
    try {
      setIsProcessing(true);
      const { dataset, data } = await loadDataset(datasetId);
      
      // Check if there are existing images and ask for confirmation
      let shouldOverwrite = true;
      if (images.length > 0) {
        const userChoice = confirm(
          `You currently have ${images.length} image(s) loaded.\n\n` +
          `Click "OK" to REPLACE them with the dataset images.\n` +
          `Click "Cancel" to ADD the dataset images to your current ones.`
        );
        shouldOverwrite = userChoice;
      }
      
      // Update settings from loaded dataset
      setSettings({
        ...defaultSettings,
        ...dataset.settings
      });
      
      // Convert data entries back to ImageWithCaption format
      const loadedImages: ImageWithCaption[] = [];
      
      for (const dataEntry of data) {
        try {
          const response = await fetch(dataEntry.image_url);
          const blob = await response.blob();
          const file = new File([blob], dataEntry.image_name, { type: blob.type });
          
          const imageWithCaption: ImageWithCaption = {
            id: dataEntry.id,
            file,
            url: dataEntry.image_url,
            caption: dataEntry.caption,
            isProcessing: false
          };
          
          loadedImages.push(imageWithCaption);
        } catch (error) {
          console.error(`Error loading image ${dataEntry.image_name}:`, error);
        }
      }
      
      if (shouldOverwrite) {
        // Clear existing images and replace with loaded ones
        images.forEach(img => URL.revokeObjectURL(img.url));
        setImages(loadedImages);
        alert(`Replaced with dataset: ${dataset.name} (${loadedImages.length} images)`);
      } else {
        // Keep existing images and add loaded ones
        setImages(prev => [...prev, ...loadedImages]);
        alert(`Added dataset: ${dataset.name} (${loadedImages.length} images). Total: ${images.length + loadedImages.length} images`);
      }
      
      setShowDatasetModal(false);
      setDatasets([]);
      
    } catch (error) {
      console.error('Error loading dataset:', error);
      alert(`Failed to load dataset: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const openSaveModal = () => {
    setDatasetModalMode('save');
    setDatasetName(`${settings.character_name}_${new Date().toISOString().split('T')[0]}`);
    setShowDatasetModal(true);
  };

  const openLoadModal = async () => {
    try {
      const allDatasets = await getAllDatasets();
      setDatasets(allDatasets);
      setDatasetModalMode('load');
      setShowDatasetModal(true);
    } catch (error) {
      console.error('Error loading datasets:', error);
      alert('Error loading datasets');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-indigo-50">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 bg-clip-text text-transparent">
              Character Caption Generator
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Generate captions for images to train LoRA models using AI-powered captioning
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Settings Panel - Left Side */}
          <div>
            <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
              <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="w-2 h-8 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
                Caption Settings
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Character Trigger
                  </label>
                  <input
                    type="text"
                    value={settings.character_name}
                    onChange={(e) => handleInputChange('character_name', e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="Enter character trigger"
                  />
                </div>

                <div>
                  <button
                    onClick={() => setShowMoreSettings(!showMoreSettings)}
                    className="flex items-center justify-between w-full p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <span className="text-sm font-medium text-gray-700">More Settings</span>
                    <svg 
                      className={`w-5 h-5 text-gray-500 transition-transform ${showMoreSettings ? 'rotate-180' : ''}`} 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {showMoreSettings && (
                    <div className="mt-4 space-y-4 bg-gray-50 p-4 rounded-lg">
                      <div>
                        <CoolToggle
                          checked={runOnUpload}
                          onChange={setRunOnUpload}
                          label="Run on Upload"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Caption Length
                        </label>
                        <select
                          value={settings.caption_length}
                          onChange={(e) => handleInputChange('caption_length', e.target.value)}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="any">Any</option>
                          <option value="very_short">Very Short</option>
                          <option value="short">Short</option>
                          <option value="medium_length">Medium Length</option>
                          <option value="long">Long</option>
                          <option value="very_long">Very Long</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Max New Tokens
                        </label>
                        <input
                          type="number"
                          value={settings.max_new_tokens}
                          onChange={(e) => handleInputChange('max_new_tokens', parseInt(e.target.value))}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          min="1"
                          max="2048"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Temperature: {settings.temperature}
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={settings.temperature}
                          onChange={(e) => handleInputChange('temperature', parseFloat(e.target.value))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <h3 className="text-lg font-semibold mb-4">Caption Options</h3>
                <div className="space-y-2">
                  <CoolToggle
                    checked={settings.refer_character_name}
                    onChange={(checked) => handleInputChange('refer_character_name', checked)}
                    label="Refer Character Name"
                  />
                  
                  {Object.entries(settings).map(([key, value]) => {
                    if (typeof value === 'boolean' && key !== 'refer_character_name' && !moreOptionsKeys.includes(key)) {
                      return (
                        <CoolToggle
                          key={key}
                          checked={value}
                          onChange={(checked) => handleInputChange(key as keyof WorkflowSettings, checked)}
                          label={key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        />
                      );
                    }
                    return null;
                  })}
                  
                  <div className="mt-4">
                    <button
                      onClick={() => setShowMoreOptions(!showMoreOptions)}
                      className="flex items-center justify-between w-full p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <span className="text-sm font-medium text-gray-700">More Options</span>
                      <svg 
                        className={`w-5 h-5 text-gray-500 transition-transform ${showMoreOptions ? 'rotate-180' : ''}`} 
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {showMoreOptions && (
                      <div className="mt-2 space-y-2 bg-gray-50 p-4 rounded-lg">
                        {moreOptionsKeys.map((key) => {
                          const value = settings[key as keyof WorkflowSettings];
                          if (typeof value === 'boolean') {
                            return (
                              <CoolToggle
                                key={key}
                                checked={value}
                                onChange={(checked) => handleInputChange(key as keyof WorkflowSettings, checked)}
                                label={key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                              />
                            );
                          }
                          return null;
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Upload and Images - Right Side */}
          <div className="lg:col-span-3 space-y-6">
            {/* Image Upload */}
            <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
              <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                <div className="w-2 h-8 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
                Upload Images
              </h2>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImagesSelected}
                  disabled={isProcessing}
                  className="hidden"
                  id="imageInput"
                />
                <label htmlFor="imageInput" className="cursor-pointer block">
                  <div className="text-6xl mb-4">📷</div>
                  <p className="text-lg font-medium text-gray-700 mb-2">
                    Click to upload images or drag and drop
                  </p>
                  <p className="text-sm text-gray-500">
                    PNG, JPG, GIF up to 10MB each
                  </p>
                </label>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
              <div className="flex flex-wrap gap-2 justify-between items-center">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={openLoadModal}
                    disabled={isProcessing}
                    className="px-6 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold shadow-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200"
                  >
                    📚 Load from Dataset
                  </button>
                  {images.length > 0 && (
                    <>
                      <button
                        onClick={handleProcessAll}
                        disabled={images.length === 0 || images.some(img => img.isProcessing)}
                        className="px-6 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold shadow-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200"
                      >
                        🎯 Process All
                      </button>
                      <button
                        onClick={openSaveModal}
                        disabled={isProcessing || images.length === 0}
                        className="px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold shadow-lg hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200"
                      >
                        💾 Save to Dataset
                      </button>
                      <button
                        onClick={handleExport}
                        disabled={isProcessing || images.length === 0 || images.some(img => img.isProcessing)}
                        className="px-6 py-3 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold shadow-lg hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200"
                      >
                        📦 Download ZIP
                      </button>
                      <button
                        onClick={handleClearAll}
                        disabled={isProcessing}
                        className="px-6 py-3 rounded-2xl bg-gradient-to-r from-red-600 to-pink-600 text-white font-bold shadow-lg hover:from-red-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200"
                      >
                        🗑️ Clear All
                      </button>
                    </>
                  )}
                </div>
                {images.length > 0 && (
                  <div className="text-sm text-gray-600">
                    {images.filter(img => img.caption && !img.isProcessing).length} / {images.length} processed
                  </div>
                )}
              </div>
            </div>
            
            {/* Image Grid */}
            {images.length > 0 && (
              <div className="rounded-3xl border border-gray-200/80 p-6 md:p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
                <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
                  <div className="w-2 h-8 bg-gradient-to-b from-purple-500 to-pink-600 rounded-full"></div>
                  Images & Captions
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {images.map((image) => (
                    <div key={image.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="relative">
                        {image.url ? (
                          <img
                            src={image.url}
                            alt={image.file.name}
                            className="w-full h-64 object-cover"
                          />
                        ) : (
                          <div className="w-full h-64 bg-gray-200 flex items-center justify-center">
                            <div className="text-center">
                              <div className="text-4xl mb-2">🖼️</div>
                              <p className="text-gray-500 text-sm">Loading image...</p>
                            </div>
                          </div>
                        )}
                        {image.isProcessing && (
                          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          </div>
                        )}
                        <button
                          onClick={() => handleRerunImage(image.id)}
                          disabled={image.isProcessing}
                          className="absolute top-2 right-2 p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs"
                        >
                          Rerun
                        </button>
                      </div>
                      <div className="p-4">
                        <div className="text-sm text-gray-600 mb-2 truncate">
                          {image.file.name}
                        </div>
                        <textarea
                          value={image.caption}
                          onChange={(e) => handleCaptionEdit(image.id, e.target.value)}
                          placeholder={image.isProcessing ? "Generating caption..." : "Caption will appear here..."}
                          disabled={image.isProcessing}
                          rows={4}
                          className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-vertical disabled:bg-gray-100"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Save Dataset Modal */}
      {showDatasetModal && datasetModalMode === 'save' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold mb-4">Save Dataset</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Dataset Name
                </label>
                <input
                  type="text"
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter dataset name"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowDatasetModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDataset}
                disabled={!datasetName.trim() || isProcessing}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Dataset Modal */}
      {showDatasetModal && datasetModalMode === 'load' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">Load Dataset</h3>
            <div className="space-y-3">
              {datasets.length > 0 ? (
                datasets.map((dataset) => (
                  <div key={dataset.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-500 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-gray-800">{dataset.name}</h4>
                      <span className="text-xs text-gray-500">{new Date(dataset.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm text-gray-600">Trigger: {dataset.character_trigger}</p>
                      <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-medium">
                        {dataset.image_count !== undefined ? `${dataset.image_count} images` : 'Loading...'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleLoadDataset(dataset.id)}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Load Dataset
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No datasets found. Create some datasets first!
                </div>
              )}
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowDatasetModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}