// Environment configuration for the MultiTalk UI application

interface EnvironmentConfig {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
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
  const isProd = isProduction();
  
  return {
    apiBaseUrl: isProd 
      ? (import.meta.env.VITE_API_BASE_URL || 'https://vapai-plataforma-backend-4daa799bd90b.herokuapp.com/api')
      : (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'),
    
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://rwbhfxltyxaegtalgxdx.supabase.co',
    
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3YmhmeGx0eXhhZWd0YWxneGR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0Njc3OTMsImV4cCI6MjA3MTA0Mzc5M30.2euUdw7ubhbyQ_orFYJxJByPuRxl21QFO3cmZtnVRos',
    
    environment: isProd ? 'production' : 'development'
  };
};

// Export the configuration
export const config = getEnvironmentConfig();

// Export utility functions
export { isProduction, getEnvironmentConfig };

// Log configuration in development
if (!isProduction()) {
  console.log('🔧 Environment Configuration:', {
    ...config,
    supabaseAnonKey: config.supabaseAnonKey.substring(0, 20) + '...' // Hide sensitive key
  });
}
