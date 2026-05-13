import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, Save, User } from 'lucide-react';
import { api } from '../../lib/api';
import { logout } from '../../lib/auth';
import { QUERY_KEYS } from '../../lib/constants';
import { Button } from '../UI/Button';

export function ProfilePage() {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const { data: profile, isLoading, error } = useQuery({
    queryKey: [QUERY_KEYS.PROFILE],
    queryFn: () => api.getProfile(),
  });

  useEffect(() => {
    if (profile?.display_name != null) {
      setDisplayName(profile.display_name);
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: (data: { display_name?: string }) => api.updateProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.PROFILE] });
      setSuccessMessage('Profile updated successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    },
  });

  const handleSave = () => {
    updateMutation.mutate({ display_name: displayName });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading profile...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-sm text-destructive">Failed to load profile</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12">
      <div className="w-full max-w-lg rounded-lg border border-border/60 bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <User className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-xl font-display font-semibold tracking-tight text-foreground">
            Profile Settings
          </h1>
        </div>

        {successMessage && (
          <div className="mb-4 rounded-md bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
            {successMessage}
          </div>
        )}

        {updateMutation.isError && (
          <div className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Failed to update profile
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Email
            </label>
            <input
              type="email"
              value={profile?.email || ''}
              disabled
              className="h-9 w-full rounded-lg border border-border bg-muted/50 px-3 text-sm text-muted-foreground cursor-not-allowed"
            />
          </div>

          <div>
            <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-foreground">
              Display name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full"
          >
            <Save className="mr-2 h-4 w-4" />
            {updateMutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>

        <div className="mt-8 border-t border-border/60 pt-6">
          <Button
            variant="destructive"
            onClick={logout}
            className="w-full"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Log out
          </Button>
        </div>
      </div>
    </div>
  );
}
