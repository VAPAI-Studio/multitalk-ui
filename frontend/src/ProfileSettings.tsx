import { useState, useRef, useEffect } from 'react';
import { useAuth, type User } from './contexts/AuthContext';
import { apiClient } from './lib/apiClient';

interface Props {
  onNavigateBack: () => void;
}

export default function ProfileSettings({ onNavigateBack }: Props) {
  const { user } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // API Key state
  const [apiKeyInfo, setApiKeyInfo] = useState<{
    has_key: boolean;
    key_info?: { key_prefix: string; name: string; created_at: string; last_used_at?: string };
  } | null>(null);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [isRevokingKey, setIsRevokingKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [keyMessage, setKeyMessage] = useState('');

  // Load API key info on mount
  useEffect(() => {
    if (user) {
      apiClient.getCurrentApiKey()
        .then(setApiKeyInfo)
        .catch(() => setApiKeyInfo({ has_key: false }));
    }
  }, [user]);

  if (!user) return null;

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setMessage('Please upload a valid image (JPG, PNG, WebP)');
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setMessage('Image must be smaller than 5MB');
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);

    // Upload immediately
    setIsUploading(true);
    setMessage('');

    try {
      const response = await apiClient.uploadProfilePicture(file);

      // Update user in localStorage
      const updatedUser: User = {
        ...user,
        profile_picture_url: response.profile_picture_url
      };
      localStorage.setItem('vapai-user', JSON.stringify(updatedUser));

      // Force page reload to update auth context
      window.location.reload();

    } catch (error: any) {
      setMessage(`${error.message || 'Upload failed'}`);
      setPreviewUrl(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletePicture = async () => {
    if (!confirm('Are you sure you want to delete your profile picture?')) {
      return;
    }

    setIsDeleting(true);
    setMessage('');

    try {
      await apiClient.deleteProfilePicture();

      // Update user in localStorage
      const updatedUser: User = {
        ...user,
        profile_picture_url: null
      };
      localStorage.setItem('vapai-user', JSON.stringify(updatedUser));

      // Force page reload to update auth context
      window.location.reload();

    } catch (error: any) {
      setMessage(`${error.message || 'Delete failed'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    setMessage('');

    try {
      await apiClient.updateProfile({ full_name: fullName });

      // Update user in localStorage
      const updatedUser: User = {
        ...user,
        full_name: fullName
      };
      localStorage.setItem('vapai-user', JSON.stringify(updatedUser));

      setMessage('Profile updated successfully!');
      setTimeout(() => {
        window.location.reload();
      }, 1000);

    } catch (error: any) {
      setMessage(`${error.message || 'Update failed'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateKey = async () => {
    if (apiKeyInfo?.has_key) {
      if (!confirm('This will revoke your current API key and generate a new one. Continue?')) {
        return;
      }
    }

    setIsGeneratingKey(true);
    setKeyMessage('');
    setNewApiKey(null);

    try {
      const response = await apiClient.generateApiKey();
      if (response.success && response.api_key) {
        setNewApiKey(response.api_key);
        setKeyMessage(response.message);
        // Refresh key info
        const info = await apiClient.getCurrentApiKey();
        setApiKeyInfo(info);
      }
    } catch (error: any) {
      setKeyMessage(`${error.message || 'Failed to generate API key'}`);
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const handleRevokeKey = async () => {
    if (!confirm('Are you sure you want to revoke your API key? Any integrations using it will stop working.')) {
      return;
    }

    setIsRevokingKey(true);
    setKeyMessage('');

    try {
      await apiClient.revokeApiKey();
      setApiKeyInfo({ has_key: false });
      setNewApiKey(null);
      setKeyMessage('API key revoked successfully');
    } catch (error: any) {
      setKeyMessage(`${error.message || 'Failed to revoke API key'}`);
    } finally {
      setIsRevokingKey(false);
    }
  };

  const copyKeyToClipboard = async () => {
    if (newApiKey) {
      await navigator.clipboard.writeText(newApiKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const currentAvatarUrl = previewUrl || user.profile_picture_url;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-6 md:p-10">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={onNavigateBack}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="text-3xl md:text-4xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
            Profile Settings
          </h1>
        </div>

        {/* Profile Card */}
        <div className="rounded-3xl border border-gray-200/80 p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm">
          {/* Avatar Section */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative mb-6">
              {currentAvatarUrl ? (
                <img
                  src={currentAvatarUrl}
                  alt="Profile"
                  className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-xl"
                />
              ) : (
                <div className="w-32 h-32 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center border-4 border-white shadow-xl">
                  <span className="text-white text-4xl font-bold">
                    {(user.full_name?.[0] || user.email?.[0] || 'U').toUpperCase()}
                  </span>
                </div>
              )}
              {isUploading && (
                <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                  <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isDeleting}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold shadow-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isUploading ? 'Uploading...' : 'Upload Photo'}
              </button>

              {user.profile_picture_url && (
                <button
                  onClick={handleDeletePicture}
                  disabled={isUploading || isDeleting}
                  className="px-6 py-3 rounded-2xl border-2 border-red-500 text-red-500 font-semibold hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>

            <p className="text-xs text-gray-500 mt-3">
              JPG, PNG, or WebP. Max 5MB.
            </p>
          </div>

          {/* Profile Info Section */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                Email
              </label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-500 bg-gray-100 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                Email cannot be changed
              </p>
            </div>
          </div>

          {/* Message */}
          {message && (
            <div className="mt-6 p-4 rounded-2xl bg-gray-100 border border-gray-200">
              <p className="text-sm text-center">{message}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 mt-8">
            <button
              onClick={handleSaveProfile}
              disabled={isSaving || isUploading || isDeleting}
              className="flex-1 px-8 py-4 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold text-lg shadow-lg hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>

            <button
              onClick={onNavigateBack}
              disabled={isSaving || isUploading || isDeleting}
              className="px-8 py-4 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* API Key Section */}
        <div className="rounded-3xl border border-gray-200/80 p-8 shadow-lg bg-gradient-to-br from-white to-gray-50/50 backdrop-blur-sm mt-8">
          <h2 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-3">
            <div className="w-2 h-8 bg-gradient-to-b from-orange-500 to-red-600 rounded-full"></div>
            API Key
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Use an API key to authenticate programmatic access (e.g., from OpenClaw or scripts).
            Include it as <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">X-API-Key</code> header in requests.
          </p>

          {/* Newly generated key (shown once) */}
          {newApiKey && (
            <div className="mb-6 p-4 rounded-2xl bg-green-50 border-2 border-green-200">
              <p className="text-sm font-semibold text-green-800 mb-2">
                Your new API key (copy it now — it will not be shown again):
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-3 bg-white rounded-xl border border-green-300 font-mono text-sm break-all select-all">
                  {newApiKey}
                </code>
                <button
                  onClick={copyKeyToClipboard}
                  className="px-4 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-colors shrink-0"
                >
                  {keyCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* Existing key info */}
          {apiKeyInfo?.has_key && !newApiKey && (
            <div className="mb-6 p-4 rounded-2xl bg-gray-50 border border-gray-200">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span className="font-mono bg-white px-3 py-1 rounded-lg border border-gray-200">
                  {apiKeyInfo.key_info?.key_prefix}...
                </span>
                <span className="text-gray-500">
                  Created: {formatDate(apiKeyInfo.key_info?.created_at)}
                </span>
                <span className="text-gray-500">
                  Last used: {formatDate(apiKeyInfo.key_info?.last_used_at)}
                </span>
              </div>
            </div>
          )}

          {/* Key message */}
          {keyMessage && (
            <div className="mb-4 p-3 rounded-xl bg-gray-100 border border-gray-200">
              <p className="text-sm text-center text-gray-700">{keyMessage}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleGenerateKey}
              disabled={isGeneratingKey || isRevokingKey}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 text-white font-semibold shadow-lg hover:from-orange-600 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {isGeneratingKey ? 'Generating...' : apiKeyInfo?.has_key ? 'Regenerate Key' : 'Generate API Key'}
            </button>
            {apiKeyInfo?.has_key && (
              <button
                onClick={handleRevokeKey}
                disabled={isGeneratingKey || isRevokingKey}
                className="px-6 py-3 rounded-2xl border-2 border-red-500 text-red-500 font-semibold hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isRevokingKey ? 'Revoking...' : 'Revoke'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
