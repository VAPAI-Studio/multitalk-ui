# Google Drive Integration Setup

This guide explains how to set up the Google Drive integration for accessing shared drives.

## Prerequisites

1. A Google Cloud project
2. Access to a Shared Drive in your organization
3. Admin permissions to add members to the Shared Drive

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it (e.g., `multitalk-drive-integration`)
4. Click "Create"

## Step 2: Enable Google Drive API

1. In your project, go to **APIs & Services** → **Library**
2. Search for "Google Drive API"
3. Click on it and press **Enable**

## Step 3: Create a Service Account

1. Go to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Fill in:
   - **Name**: `multitalk-drive-access`
   - **Description**: `Service account for MultiTalk UI to access Google Drive`
4. Click **Create and Continue**
5. Skip role assignment (we'll use Drive sharing instead)
6. Click **Done**

## Step 4: Create and Download JSON Key

1. Click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key** → **Create new key**
4. Choose **JSON** format
5. Click **Create**
6. Save the downloaded file to `backend/credentials/google-drive-service-account.json`

> **Security Note**: Never commit this file to git. It's already in `.gitignore`.

## Step 5: Add Service Account to Shared Drive

1. Open Google Drive and go to **Shared drives**
2. Find your shared drive (e.g., "producción")
3. Right-click → **Manage members**
4. Add the service account email address
   - It looks like: `multitalk-drive-access@your-project.iam.gserviceaccount.com`
   - (Find it in the Service Accounts page)
5. Set permission to **Viewer** (or **Content manager** for write access later)
6. Click **Send**

## Step 6: Get the Shared Drive ID

1. Open the shared drive in your browser
2. Look at the URL: `https://drive.google.com/drive/folders/DRIVE_ID`
3. Copy the `DRIVE_ID` part

Alternatively:
1. Right-click on the shared drive
2. Click **Copy link**
3. The ID is the last part of the URL

## Step 7: Configure Environment Variables

Add to your `backend/.env` file:

```env
# Google Drive Configuration
GOOGLE_DRIVE_CREDENTIALS_FILE=./credentials/google-drive-service-account.json
GOOGLE_DRIVE_SHARED_DRIVE_ID=your-drive-id-from-step-6
```

## Step 8: Test the Connection

1. Start the backend server:
   ```bash
   cd backend
   source venv/bin/activate
   python -m uvicorn main:app --reload --port 8000
   ```

2. Test the connection:
   ```bash
   curl http://localhost:8000/api/google-drive/status
   ```

3. Expected successful response:
   ```json
   {
     "success": true,
     "connected": true,
     "drive_name": "producción",
     "drive_id": "...",
     "error": null
   }
   ```

4. List files in the drive:
   ```bash
   curl http://localhost:8000/api/google-drive/files
   ```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/google-drive/status` | Check connection to shared drive |
| GET | `/api/google-drive/files` | List files (optional: `folder_id`, `page_size`, `page_token`) |
| GET | `/api/google-drive/folders/{id}` | Get folder metadata and contents |

## Production Deployment (Heroku)

For Heroku or other platforms where you can't upload files:

1. Open your service account JSON file
2. Copy the entire JSON content
3. Add it as a Config Var:
   ```
   GOOGLE_DRIVE_CREDENTIALS_JSON='{"type":"service_account","project_id":"...",...}'
   ```
4. Also add:
   ```
   GOOGLE_DRIVE_SHARED_DRIVE_ID=your-drive-id
   ```

The code will automatically detect and use the JSON string if the file doesn't exist.

## Troubleshooting

### "Google Drive not configured"

- Check that either `GOOGLE_DRIVE_CREDENTIALS_FILE` or `GOOGLE_DRIVE_CREDENTIALS_JSON` is set
- Verify the file path is correct and the file exists
- Check that `GOOGLE_DRIVE_SHARED_DRIVE_ID` is set

### "Access denied" or "File not found"

- Verify the service account email was added to the Shared Drive
- Check the permission level (at least Viewer)
- Confirm the Drive ID is correct

### "Invalid credentials"

- The JSON file may be corrupted
- Re-download the key from Google Cloud Console
- Make sure the JSON is valid (no extra characters)

### "API not enabled"

- Go to Google Cloud Console → APIs & Services → Library
- Enable the "Google Drive API"

## Security Best Practices

1. **Never commit credentials** - The `backend/credentials/` directory is gitignored
2. **Use minimal permissions** - Start with Viewer access, upgrade only if needed
3. **Rotate keys periodically** - Create new keys and delete old ones
4. **Monitor access** - Check Google Cloud Console for unusual activity
5. **Use environment variables in production** - Don't store sensitive data in code
