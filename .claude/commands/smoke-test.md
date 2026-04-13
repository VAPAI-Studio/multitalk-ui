# Smoke Test — Dev Backend

Run the smoke test suite against the dev backend (`vapai-plataforma-backend-dev`).

Checks:
1. Health endpoint returns `healthy`
2. Auth rejects bad credentials with 401 (not 500)
3. Screenwriter projects endpoint requires auth (401)
4. ComfyUI workflows list returns `success: true`
5. CORS allows `dev.vapai.studio` origin
6. Environment is detected as `heroku`

Execute the hook script directly and report results:

```bash
bash .githooks/pre-push
```

If any check fails, show the failing response and suggest a fix.
