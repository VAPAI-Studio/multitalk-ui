# Environment Setup for MultiTalk UI

This guide explains how to configure environment variables for different deployment environments.

## How It Works

The application automatically detects whether it's running in development or production and uses the appropriate backend API URL:

- **Development (localhost)**: Uses `http://localhost:8000/api` by default
- **Production (deployed)**: Uses `https://vapai-plataforma-backend-4daa799bd90b.herokuapp.com/api` by default

## Configuration Methods

### 1. Environment Variables (Recommended)

Create environment files or set variables in your deployment platform:

#### For Local Development
Create a `.env.local` file in the `frontend/` directory:

```env
# Backend API Configuration
VITE_API_BASE_URL=http://localhost:8000/api

# Supabase Configuration
VITE_SUPABASE_URL=https://rwbhfxltyxaegtalgxdx.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Environment identifier
VITE_ENVIRONMENT=development
```

#### For Production Deployment
Set these environment variables in your deployment platform (Vercel, Netlify, etc.):

```env
VITE_API_BASE_URL=https://vapai-plataforma-backend-4daa799bd90b.herokuapp.com/api
VITE_SUPABASE_URL=https://rwbhfxltyxaegtalgxdx.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_ENVIRONMENT=production
```

### 2. Automatic Detection (Default Behavior)

If no environment variables are set, the app will automatically detect the environment:

- **Detects Production** if:
  - Hostname is not `localhost` or `127.0.0.1`
  - Vite mode is `production`
  - `VITE_ENVIRONMENT` is set to `production`

- **Uses Development** otherwise

## Deployment Platforms

### Vercel
Add environment variables in your Vercel dashboard under:
Project Settings → Environment Variables

### Netlify
Add environment variables in your Netlify dashboard under:
Site Settings → Environment Variables

### Heroku (if frontend is also on Heroku)
Set config vars using the CLI or dashboard:
```bash
heroku config:set VITE_API_BASE_URL=https://vapai-plataforma-backend-4daa799bd90b.herokuapp.com/api
```

## Testing the Configuration

When running locally, check the browser console for:
```
🔧 Environment Configuration: {
  apiBaseUrl: "http://localhost:8000/api",
  environment: "development",
  ...
}
```

## Backend API Status

You can verify the backend is running by visiting:
- Local: http://localhost:8000/
- Production: https://vapai-plataforma-backend-4daa799bd90b.herokuapp.com/

Both should return: `{"message":"MultiTalk API is running"}`
