import { useState, useRef } from 'react';
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

  if (!user) return null;

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setMessage('❌ Please upload a valid image (JPG, PNG, WebP)');
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setMessage('❌ Image must be smaller than 5MB');
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
      setMessage(`❌ ${error.message || 'Upload failed'}`);
      setPreviewUrl(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletePicture = async () => {
    if (!confirm('¿Estás seguro de que quieres eliminar tu foto de perfil?')) {
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
      setMessage(`❌ ${error.message || 'Delete failed'}`);
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

      setMessage('✅ Profile updated successfully!');
      setTimeout(() => {
        window.location.reload();
      }, 1000);

    } catch (error: any) {
      setMessage(`❌ ${error.message || 'Update failed'}`);
    } finally {
      setIsSaving(false);
    }
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
            Volver
          </button>
          <h1 className="text-3xl md:text-4xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
            Configuración de Perfil
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
                {isUploading ? 'Subiendo...' : 'Subir Foto'}
              </button>

              {user.profile_picture_url && (
                <button
                  onClick={handleDeletePicture}
                  disabled={isUploading || isDeleting}
                  className="px-6 py-3 rounded-2xl border-2 border-red-500 text-red-500 font-semibold hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {isDeleting ? 'Eliminando...' : 'Eliminar'}
                </button>
              )}
            </div>

            <p className="text-xs text-gray-500 mt-3">
              JPG, PNG o WebP. Máximo 5MB.
            </p>
          </div>

          {/* Profile Info Section */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                Nombre Completo
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                placeholder="Tu nombre"
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
                El email no se puede cambiar
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
              {isSaving ? 'Guardando...' : 'Guardar Cambios'}
            </button>

            <button
              onClick={onNavigateBack}
              disabled={isSaving || isUploading || isDeleting}
              className="px-8 py-4 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
