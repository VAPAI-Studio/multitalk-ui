# LoRA Trainer Architecture

## Overview

The LoRA Trainer is a new feature that allows users to train custom QWEN Image LoRA models using datasets stored in Supabase. Unlike other features in VAPAI Studio, this trainer integrates with the Musubi Tuner API instead of ComfyUI.

## Key Differences from Other Features

### 1. External API Integration
- **Other features**: Use ComfyUI workflows hosted at `https://comfy.vapai.studio`
- **LoRA Trainer**: Uses Musubi Tuner API at `https://musubi.vapai.studio`

### 2. Data Flow
1. User selects a dataset from Supabase
2. Frontend loads dataset images with captions
3. Images are converted to base64
4. Training request sent to Musubi Tuner API with:
   - Images array (filename, base64 data, caption)
   - Output name for LoRA file
   - Training parameters (network_dim, learning_rate, epochs, etc.)
5. API returns job_id
6. Frontend polls for training status every 2 seconds
7. Progress updates shown in real-time
8. Completed LoRA saved to ComfyUI's LoRA directory

### 3. Training Parameters

- **network_dim** (1-256): LoRA rank/dimension
- **network_alpha** (0.1-10): Alpha scaling factor
- **learning_rate** (0.00001-0.001): Learning rate
- **max_train_epochs** (1-100): Number of training epochs
- **seed** (any integer): Random seed for reproducibility
- **resolution** ([512,512], [768,768], [1024,1024]): Training image resolution

## Components

### Frontend Components

1. **LoRATrainer.tsx** (`/frontend/src/LoRATrainer.tsx`)
   - Main page component
   - Dataset selection UI
   - Training parameter configuration
   - Real-time progress tracking
   - Job history sidebar

2. **API Client Methods** (`/frontend/src/lib/apiClient.ts`)
   - `startMusubiTraining()` - Submit training job
   - `getMusubiTrainingStatus()` - Poll job status
   - `getMusubiTrainingLogs()` - Get training logs
   - `cancelMusubiTraining()` - Cancel running job
   - `getMusubiTrainingJobs()` - List all jobs
   - `getMusubiHealth()` - Check API health

### Backend Integration

The Musubi Tuner API provides these endpoints:

- `POST /train` - Start training
- `GET /train/status/{job_id}` - Get job status
- `GET /train/logs/{job_id}` - Get training logs
- `POST /train/cancel/{job_id}` - Cancel training
- `GET /train/jobs` - List all jobs
- `GET /health` - Health check

## Status Flow

```
idle → preparing → caching_latents → caching_text → training → completed
                                                              ↘ failed
                                                              ↘ cancelled
```

## Progress Tracking

The training job status includes:
- **status**: Current status (idle, preparing, training, etc.)
- **progress**: Percentage complete (0-100)
- **current_epoch**: Current training epoch
- **current_step**: Current step within epoch
- **total_steps**: Total steps for training
- **loss**: Current training loss
- **message**: Human-readable status message
- **output_path**: Path to saved LoRA (when completed)

## Output Location

Trained LoRAs are saved to:
```
C:\Users\PC\Desktop\ComfyUI_windows_portable\ComfyUI\models\loras\QWEN\{output_name}.safetensors
```

## UI Features

1. **Dataset Selection**
   - Dropdown to select from Supabase datasets
   - Preview grid showing first 12 images
   - Hover to see image captions

2. **Training Configuration**
   - Output name input
   - Network dimension slider
   - Learning rate input
   - Epoch count
   - Resolution selector

3. **Progress Tracking**
   - Real-time status messages
   - Progress bar showing percentage
   - Epoch and step counters
   - Current loss display
   - Cancel button during training

4. **Job History Sidebar**
   - List of all training jobs
   - Status badges (color-coded)
   - Progress bars for active jobs
   - Persistent across page navigation

## Navigation Integration

- **App.tsx**: Added "lora-trainer" to page types
- **Homepage.tsx**: Added app card with description
- **Sidebar**: Added navigation button with 🧬 icon
- **Route**: Renders LoRATrainer component (no comfyUrl prop needed)

## Future Enhancements

1. **Log Viewer**: Display full training logs in UI
2. **Dataset Management**: Create/edit datasets directly from trainer
3. **Model Preview**: Preview generated samples during training
4. **Advanced Parameters**: Expose more training parameters
5. **Batch Training**: Train multiple LoRAs from different datasets
6. **Cost Estimation**: Show estimated training time/cost
7. **LoRA Library**: View and manage trained LoRAs

## Testing Checklist

- [ ] Dataset selection loads images
- [ ] Training starts successfully
- [ ] Progress updates in real-time
- [ ] Status messages display correctly
- [ ] Cancel button works
- [ ] Job history persists
- [ ] Completed LoRA saves to correct path
- [ ] Error handling for failed training
- [ ] Navigation integrates properly
- [ ] Homepage card navigates correctly

## Related Files

- `/frontend/src/LoRATrainer.tsx` - Main component
- `/frontend/src/lib/apiClient.ts` - API methods
- `/frontend/src/App.tsx` - Navigation integration
- `/frontend/src/Homepage.tsx` - Homepage card

## API Documentation

See Musubi Tuner API docs at: `https://musubi.vapai.studio/docs`
