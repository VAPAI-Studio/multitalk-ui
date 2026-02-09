import { useState, useEffect } from 'react';
import { type StudioConfig, setLastUsedApp, sortAppsByLastUsed } from '../lib/studioConfig';

// Import all page components
import LipsyncOnePerson from '../pages/LipsyncOnePerson';
import LipsyncMultiPerson from '../pages/LipsyncMultiPerson';
import VideoLipsync from '../pages/VideoLipsync';
import NanoBanana from '../pages/NanoBanana';
import CameraAngle from '../pages/CameraAngle';
import StyleTransfer from '../pages/StyleTransfer';
import CreateImage from '../pages/CreateImage';
import ImageGrid from '../pages/ImageGrid';
import WANI2V from '../pages/WANI2V';
import WANMove from '../pages/WANMove';
import LTX2I2V from '../pages/LTX2I2V';
import AudioStemSeparator from '../pages/AudioStemSeparator';
import CharacterCaption from '../pages/CharacterCaption';
import LoRATrainer from '../pages/LoraTrainer';

interface StudioPageProps {
  studio: StudioConfig;
  comfyUrl: string;
}

// Map app IDs to their components
const appComponents: Record<string, React.ComponentType<{ comfyUrl: string }> | React.ComponentType<object>> = {
  'lipsync-one-person': LipsyncOnePerson,
  'lipsync-multi-person': LipsyncMultiPerson,
  'video-lipsync': VideoLipsync,
  'nano-banana': NanoBanana,
  'camera-angle': CameraAngle,
  'style-transfer': StyleTransfer,
  'create-image': CreateImage,
  'image-grid': ImageGrid,
  'wan-i2v': WANI2V,
  'wan-move': WANMove,
  'ltx2-i2v': LTX2I2V,
  'audio-stem-separator': AudioStemSeparator,
  'character-caption': CharacterCaption,
  'lora-trainer': LoRATrainer,
};

export default function StudioPage({ studio, comfyUrl }: StudioPageProps) {
  // Get apps sorted by last used
  const sortedApps = sortAppsByLastUsed(studio);

  // State for selected app - default to first (last used) app
  const [selectedAppId, setSelectedAppId] = useState<string>(sortedApps[0]?.id || '');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Track last used when app changes
  useEffect(() => {
    if (selectedAppId) {
      setLastUsedApp(studio.id, selectedAppId);
    }
  }, [selectedAppId, studio.id]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setIsDropdownOpen(false);
    if (isDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isDropdownOpen]);

  // Coming Soon state
  if (studio.comingSoon) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-gray-50 to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
        <div className="text-center space-y-6 p-12">
          <div className={`w-24 h-24 bg-gradient-to-br ${studio.gradient} rounded-3xl flex items-center justify-center shadow-2xl mx-auto`}>
            <span className="text-5xl">{studio.icon}</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-gray-900 dark:text-white">
            {studio.title}
          </h1>
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-gray-200/80 dark:bg-gray-700/80 rounded-2xl">
            <span className="text-lg">🚧</span>
            <span className="text-lg font-semibold text-gray-600 dark:text-gray-300">Coming Soon</span>
          </div>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            {studio.description}
          </p>
        </div>
      </div>
    );
  }

  // Get selected app config
  const selectedApp = studio.apps.find(app => app.id === selectedAppId) || sortedApps[0];

  // Get the component for the selected app
  const AppComponent = selectedApp ? appComponents[selectedApp.id] : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      {/* App Switcher Header - Only show if studio has multiple apps */}
      {studio.apps.length > 1 && (
        <div className="sticky top-16 z-10 bg-white/80 dark:bg-dark-surface/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-700/50">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center gap-4">
              {/* Studio Icon */}
              <div className={`w-10 h-10 bg-gradient-to-br ${studio.gradient} rounded-xl flex items-center justify-center shadow-lg`}>
                <span className="text-xl">{studio.icon}</span>
              </div>

              {/* App Selector Dropdown */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(!isDropdownOpen);
                  }}
                  className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-dark-surface-primary rounded-xl border-2 border-gray-200 dark:border-dark-border-primary hover:border-gray-300 dark:hover:border-gray-600 shadow-sm hover:shadow-md transition-all duration-200"
                >
                  <span className="text-xl">{selectedApp?.icon}</span>
                  <span className="text-lg font-bold text-gray-800 dark:text-white">
                    {selectedApp?.title}
                  </span>
                  <svg
                    className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-dark-surface-primary rounded-xl shadow-2xl border border-gray-200 dark:border-dark-border-primary py-2 z-50">
                    {sortedApps.map((app) => (
                      <button
                        key={app.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAppId(app.id);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-200 ${
                          app.id === selectedAppId
                            ? `bg-gradient-to-r ${app.gradient} text-white`
                            : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <span className="text-xl">{app.icon}</span>
                        <div className="flex-1">
                          <span className="font-semibold block">{app.title}</span>
                          <span className={`text-xs ${app.id === selectedAppId ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>
                            {app.features[0]}
                          </span>
                        </div>
                        {app.id === selectedAppId && (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* App Description */}
              <p className="hidden md:block text-sm text-gray-500 dark:text-gray-400 flex-1 truncate">
                {selectedApp?.description}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Render the selected app component */}
      <div className={studio.apps.length > 1 ? '' : ''}>
        {AppComponent && (
          selectedApp?.id === 'lora-trainer' ? (
            <div className="w-full max-w-7xl mx-auto p-6">
              <LoRATrainer />
            </div>
          ) : (
            <div className="w-full max-w-6xl mx-auto p-6">
              <AppComponent comfyUrl={comfyUrl} />
            </div>
          )
        )}
      </div>
    </div>
  );
}
