// Environment configuration for the MultiTalk UI application

interface EnvironmentConfig {
  apiBaseUrl: string;
  environment: 'development' | 'production';
}

// Check if we're in production based on various indicators
const isProduction = (): boolean => {
  // Check if deployed on common hosting platforms
  const hostname = window.location.hostname;
  const isDeploy = hostname !== 'localhost' && hostname !== '127.0.0.1';
  
  // Check Vite mode
  const viteMode = import.meta.env.MODE === 'production';
  
  // Check custom environment variable
  const customEnv = import.meta.env.VITE_ENVIRONMENT === 'production';
  
  // Return true if any production indicator is present
  return isDeploy || viteMode || customEnv;
};

// Get environment configuration
const getEnvironmentConfig = (): EnvironmentConfig => {
  // ALWAYS prioritize explicit environment variable first
  if (import.meta.env.VITE_API_BASE_URL) {
    return {
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
      environment: isProduction() ? 'production' : 'development'
    };
  }
  
  // Fallback to automatic detection only if no explicit URL is set
  const isProd = isProduction();
  
  return {
    apiBaseUrl: isProd 
      ? 'https://vapai-plataforma-backend-4daa799bd90b.herokuapp.com/api'
      : 'http://localhost:8000/api',
    environment: isProd ? 'production' : 'development'
  };
};

// Export the configuration
export const config = getEnvironmentConfig();

// Export utility functions
export { isProduction, getEnvironmentConfig };

// Log configuration in development
console.log('🔧 Environment Configuration:', {
  apiBaseUrl: config.apiBaseUrl,
  environment: config.environment,
  explicitUrl: !!import.meta.env.VITE_API_BASE_URL,
  hostname: window.location.hostname
});
