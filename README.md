# VAPAI Studio

A full-stack application for AI-powered video and audio processing with multi-character conversations. Built with React, TypeScript, FastAPI, ComfyUI, and Supabase.

## Features

VAPAI Studio offers a comprehensive suite of AI-powered media creation tools:

- 🎬 **Lipsync 1 Person** - Generate realistic talking videos from single person images
- 🎵 **Lipsync Multi Person** - Create multi-character conversations with synchronized audio
- 🎬 **Video Lipsync** - Add perfect lip-sync to existing videos
- ✨ **Image Edit** - AI-powered image editing with natural language
- 📝 **Character Caption** - Generate training datasets for LoRA models
- 🎬 **WAN I2V** - Transform images into videos
- 🎨 **Style Transfer** - Artistic style transfer between images
- 🖼️ **Generation Feed** - Unified interface for all your generations

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS
- **Backend**: FastAPI, Python 3.11+, Pydantic
- **AI Workflows**: ComfyUI integration
- **Database & Auth**: Supabase (PostgreSQL + Auth)
- **Storage**: Supabase Storage

## Project Structure

```
multitalk-ui/
├── frontend/          # React + TypeScript frontend
│   ├── src/
│   ├── public/
│   └── package.json
├── backend/           # FastAPI backend
│   ├── main.py
│   ├── requirements.txt
│   └── api/
├── CLAUDE.md          # Detailed architecture & development guide
├── new_feature_guide.md  # Guide for adding new features
└── README.md          # This file
```

## Development

### Frontend Development

```bash
cd frontend
npm install
npm run dev
```

### Backend Development

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your configuration
python main.py
```

## Deployment

### Backend (Heroku)

The backend automatically detects Heroku environment and uses appropriate configuration:

1. **Create Heroku app and set environment variables**:
```bash
heroku create your-app-name
heroku config:set SUPABASE_URL=your_supabase_url
heroku config:set SUPABASE_ANON_KEY=your_supabase_anon_key
heroku config:set OPENROUTER_API_KEY=your_openrouter_api_key
heroku config:set COMFYUI_SERVER_URL=your_comfyui_url
```

2. **Deploy using Git**:
```bash
git add .
git commit -m "Deploy to Heroku"
git push heroku main
```

**Environment Detection**:
- **Local**: Uses `.env` file via python-dotenv
- **Heroku**: Uses Heroku config vars (detected via `DYNO` environment variable)

### Frontend

The frontend can be deployed to Vercel, Netlify, or any static hosting service.

## Environment Variables

See `.env.example` files in both frontend and backend directories for required configuration.

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Complete architecture overview, development workflows, and integration patterns
- **[new_feature_guide.md](new_feature_guide.md)** - Step-by-step guide for adding new AI workflow features
- **[api_doc.md](api_doc.md)** - ComfyUI server API reference
- **[backend/setup_supabase_auth.md](backend/setup_supabase_auth.md)** - Supabase authentication setup
- **[TODO.md](TODO.md)** - Project roadmap and planned improvements
- **[docs/N8N_WORKFLOW_SETUP.md](docs/N8N_WORKFLOW_SETUP.md)** - Guide for setting up n8n workflow automation

For detailed information about the architecture, development setup, and contributing guidelines, see [CLAUDE.md](CLAUDE.md).

## Contributing

When reporting issues, please use our [issue templates](.github/ISSUE_TEMPLATE/) to ensure all necessary information is provided. This helps us understand and fix problems more quickly.
