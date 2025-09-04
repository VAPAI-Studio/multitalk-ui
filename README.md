# VAPAI Studio

A full-stack application for AI-powered video and audio processing with multi-character conversations.

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
└── README.md
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
