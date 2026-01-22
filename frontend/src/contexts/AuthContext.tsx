/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { config } from '../config/environment';
import { apiClient } from '../lib/apiClient';

export interface User {
  id: string;
  email: string;
  full_name?: string;
  profile_picture_url?: string | null;
  created_at?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);

  // Track if initial verification has run (prevents HMR re-verification)
  const initialVerificationDone = useRef(false);

  // Declare logout first so it can be referenced by other callbacks
  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setTokenExpiresAt(null);
    localStorage.removeItem('vapai-auth-token');
    localStorage.removeItem('vapai-user');
    localStorage.removeItem('vapai-refresh-token');
    localStorage.removeItem('vapai-token-expires-at');
  }, []);

  // Refresh access token using refresh token
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const storedRefreshToken = localStorage.getItem('vapai-refresh-token');
    if (!storedRefreshToken) {
      console.log('No refresh token available');
      return null;
    }

    try {
      console.log('Attempting to refresh token...');
      const response = await fetch(`${config.apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: storedRefreshToken }),
      });

      if (!response.ok) {
        console.log('Token refresh failed, logging out');
        logout();
        return null;
      }

      const data = await response.json();
      console.log('Token refreshed successfully');

      // Update state
      setToken(data.access_token);
      setUser(data.user);

      // Calculate and store expiry time
      const expiresAt = Date.now() + (data.expires_in * 1000);
      setTokenExpiresAt(expiresAt);

      // Update localStorage
      localStorage.setItem('vapai-auth-token', data.access_token);
      localStorage.setItem('vapai-user', JSON.stringify(data.user));
      localStorage.setItem('vapai-refresh-token', data.refresh_token);
      localStorage.setItem('vapai-token-expires-at', expiresAt.toString());

      return data.access_token;
    } catch (error) {
      console.error('Token refresh error:', error);
      logout();
      return null;
    }
  }, [logout]);

  // Register refresh callback with API client
  useEffect(() => {
    apiClient.setRefreshTokenCallback(refreshAccessToken);
  }, [refreshAccessToken]);

  // Verify token with improved error handling
  const verifyToken = useCallback(async (authToken: string) => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const userData = await response.json();

        // Preserve profile_picture_url from localStorage since backend doesn't store it
        const storedUser = localStorage.getItem('vapai-user');
        const localProfilePictureUrl = storedUser ? JSON.parse(storedUser).profile_picture_url : null;

        // Merge backend data with localStorage profile picture
        setUser({
          ...userData,
          profile_picture_url: localProfilePictureUrl || userData.profile_picture_url
        });
      } else if (response.status === 401) {
        // Token invalid - try refresh
        console.log('Token invalid, attempting refresh...');
        const newToken = await refreshAccessToken();
        if (!newToken) {
          // Refresh failed, user needs to log in again
          logout();
        }
      }
      // Don't logout on other errors (network, 500, etc.) - user might just be offline
    } catch (error) {
      console.error('Token verification failed:', error);
      // Network error - don't logout, keep existing session
      // User can continue using cached data until they try an API call
    } finally {
      setLoading(false);
    }
  }, [logout, refreshAccessToken]);

  // Load auth data from localStorage on mount (with HMR protection)
  useEffect(() => {
    // Prevent re-running on HMR
    if (initialVerificationDone.current) {
      setLoading(false);
      return;
    }

    const storedToken = localStorage.getItem('vapai-auth-token');
    const storedUser = localStorage.getItem('vapai-user');
    const storedExpiresAt = localStorage.getItem('vapai-token-expires-at');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));

      if (storedExpiresAt) {
        setTokenExpiresAt(parseInt(storedExpiresAt, 10));
      }

      initialVerificationDone.current = true;
      // Verify token is still valid
      verifyToken(storedToken);
    } else {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run once on mount

  // Proactive token refresh before expiry
  useEffect(() => {
    if (!tokenExpiresAt || !token) return;

    const now = Date.now();
    const refreshTime = tokenExpiresAt - (5 * 60 * 1000); // 5 minutes before expiry

    // If already past refresh time, refresh immediately
    if (refreshTime <= now) {
      console.log('Token near expiry, refreshing now...');
      refreshAccessToken();
      return;
    }

    // Schedule refresh for 5 minutes before expiry
    const timeUntilRefresh = refreshTime - now;
    console.log(`Token refresh scheduled in ${Math.round(timeUntilRefresh / 1000 / 60)} minutes`);

    const timeoutId = setTimeout(() => {
      console.log('Scheduled token refresh triggered');
      refreshAccessToken();
    }, timeUntilRefresh);

    return () => clearTimeout(timeoutId);
  }, [tokenExpiresAt, token, refreshAccessToken]);

  const login = async (email: string, password: string) => {
    const response = await fetch(`${config.apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }

    const data = await response.json();

    // Calculate expiry time
    const expiresAt = Date.now() + (data.expires_in * 1000);

    setToken(data.access_token);
    setUser(data.user);
    setTokenExpiresAt(expiresAt);

    localStorage.setItem('vapai-auth-token', data.access_token);
    localStorage.setItem('vapai-user', JSON.stringify(data.user));
    localStorage.setItem('vapai-refresh-token', data.refresh_token);
    localStorage.setItem('vapai-token-expires-at', expiresAt.toString());
  };

  const register = async (email: string, password: string, fullName?: string) => {
    const response = await fetch(`${config.apiBaseUrl}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        full_name: fullName
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Registration failed');
    }

    const data = await response.json();

    // Calculate expiry time
    const expiresAt = Date.now() + (data.expires_in * 1000);

    setToken(data.access_token);
    setUser(data.user);
    setTokenExpiresAt(expiresAt);

    localStorage.setItem('vapai-auth-token', data.access_token);
    localStorage.setItem('vapai-user', JSON.stringify(data.user));
    localStorage.setItem('vapai-refresh-token', data.refresh_token);
    localStorage.setItem('vapai-token-expires-at', expiresAt.toString());
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        logout,
        isAuthenticated: !!user && !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
