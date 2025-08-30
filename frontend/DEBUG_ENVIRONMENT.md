# Environment Configuration Debug Guide

## How to Check Your Configuration

When the app loads, check the browser console for this message:

```
🔧 Environment Configuration: {
  apiBaseUrl: "your-actual-backend-url",
  environment: "production" | "development",
  explicitUrl: true | false,
  hostname: "your-domain.com"
}
```

### What Each Field Means:

- **`apiBaseUrl`**: The actual backend URL being used
- **`environment`**: Whether detected as dev or prod
- **`explicitUrl`**: `true` if `VITE_API_BASE_URL` was set explicitly, `false` if using auto-detection
- **`hostname`**: The current domain/hostname

### Troubleshooting:

#### Problem: Still showing `localhost:8000` in production
**Solution**: 
1. Verify `VITE_API_BASE_URL` is set in Vercel environment variables
2. Check console shows `explicitUrl: true`
3. Try a fresh deployment after setting the variable

#### Problem: Environment variable not taking effect
**Causes**:
- Variable name typo (must be exactly `VITE_API_BASE_URL`)
- Variable not set in the correct environment (production vs preview)
- Need to redeploy after setting the variable

### Testing Locally:

```bash
# Test with explicit URL
VITE_API_BASE_URL=https://your-backend.herokuapp.com/api npm run dev

# Should show in console:
# explicitUrl: true
# apiBaseUrl: "https://your-backend.herokuapp.com/api"
```

### Vercel Setup:

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   - **Key**: `VITE_API_BASE_URL`
   - **Value**: `https://vapai-plataforma-backend-4daa799bd90b.herokuapp.com/api`
   - **Environments**: Production (and Preview if needed)
3. Redeploy your application
4. Check console output to verify

The console will now always show the configuration being used, making debugging much easier!
