# Supabase Authentication Setup

## Steps to Enable Authentication in Supabase

1. **Go to your Supabase Dashboard**: https://app.supabase.com/project/rwbhfxltyxaegtalgxdx

2. **Enable Email Authentication**:
   - Go to Authentication > Providers
   - Make sure "Email" is enabled
   - Disable "Confirm email" for testing (you can enable it later for production)
   - Save changes

3. **Configure Email Templates** (Optional for testing):
   - Go to Authentication > Email Templates
   - Customize the templates as needed

4. **Check Auth Settings**:
   - Go to Authentication > Settings
   - Make sure "Enable email signups" is checked
   - Set "Site URL" to `http://localhost:5173` or your frontend URL
   - Set "Redirect URLs" to include:
     - `http://localhost:5173/**`
     - `http://localhost:8000/**`

5. **Verify API Keys**:
   - Go to Settings > API
   - Confirm your anon/public key matches the one in .env

## Testing Authentication

Once configured, you can test with:

```bash
cd backend
source venv/bin/activate
python test_auth.py
```

Or manually with curl:

```bash
# Register
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234","full_name":"Test User"}'

# Login
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234"}'

# Get current user (use token from login)
curl -X GET http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Troubleshooting

If you get "Email address is invalid":
- Email authentication might not be properly configured in Supabase
- Email confirmation might be required - disable it for testing
- Check Supabase logs in the Dashboard

If users table doesn't exist:
- Supabase automatically creates the auth.users table
- You don't need to create it manually
