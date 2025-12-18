import React, { useEffect, useRef, useState } from "react";
import { Label, Field, Section } from "./components/UI";
import { Timeline } from "./components/Timeline";
import type { VideoTrack, AudioTrackSimple } from "./components/types";
import { uploadMediaToComfy, generateId, startJobMonitoring, checkComfyUIHealth } from "./components/utils";
import { useSmartResolution } from "./hooks/useSmartResolution";
import { AVPlayerWithPadding } from "./components/AVPlayerWithPadding";
import VideoFeed from "./components/VideoFeed";
import { apiClient } from "./lib/apiClient";

interface Props {
  comfyUrl: string;
}

export default function VideoLipsync({ comfyUrl }: Props) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  // Smart resolution handling with auto-correction to multiples of 32
  const { 
    width, 
    height, 
    widthInput, 
    heightInput, 
    handleWidthChange, 
    handleHeightChange 
  } = useSmartResolution(640, 640)
  const [audioScale, setAudioScale] = useState<number>(1.5);
  const [customPrompt, setCustomPrompt] = useState<string>('a person is speaking');

  // Timeline states
  const [videoTrack, setVideoTrack] = useState<VideoTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<AudioTrackSimple | null>(null);
  const [totalDuration, setTotalDuration] = useState<number>(10);

  const trimToAudio = true;
  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string>("");
  const [originalVideoStart, setOriginalVideoStart] = useState<number>(0);
  const [originalAudioStart, setOriginalAudioStart] = useState<number>(0);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  // Load video feed from Supabase

  // Cleanup job monitor and URLs on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
      if (videoPreview) {
        URL.revokeObjectURL(videoPreview);
      }
    };
  }, [jobMonitorCleanup, audioPreviewUrl, videoPreview]);


  // Calculate the final duration based on union of video and audio coverage
  const calculateFinalDuration = () => {
    if (!videoTrack && !audioTrack) {
      return 10; // Default minimum when nothing is loaded
    }
    
    // Calculate the union: from earliest start to latest end
    let earliestStart = Infinity;
    let latestEnd = 0;
    
    if (videoTrack) {
      earliestStart = Math.min(earliestStart, videoTrack.startTime);
      latestEnd = Math.max(latestEnd, videoTrack.startTime + videoTrack.duration);
    }
    
    if (audioTrack) {
      earliestStart = Math.min(earliestStart, audioTrack.startTime);
      latestEnd = Math.max(latestEnd, audioTrack.startTime + audioTrack.duration);
    }
    
    // If we only have video, minimum duration is video duration
    if (videoTrack && !audioTrack) {
      return Math.ceil(videoTrack.duration);
    }
    
    // Total duration is the union (from earliest start to latest end)
    const unionDuration = latestEnd - Math.min(earliestStart, 0);
    
    // But minimum duration should be at least the video duration if video exists
    const minimumDuration = videoTrack ? videoTrack.duration : 0;
    
    return Math.ceil(Math.max(unionDuration, minimumDuration));
  };

  // Update total duration when tracks change
  const updateTotalDuration = () => {
    const newDuration = calculateFinalDuration();
    setTotalDuration(newDuration);
  };

  // Video file selection
  const onVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setVideoFile(file);
    
    // Clean up previous video preview URL
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
      setVideoPreview("");
    }
    
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setVideoPreview(previewUrl); // Store for preview player
      
      // Create a separate temporary URL for metadata loading
      const tempUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.addEventListener('loadedmetadata', () => {
        setVideoDuration(video.duration);
        const track: VideoTrack = {
          id: generateId(),
          file,
          startTime: 0,
          duration: video.duration,
          name: file.name
        };
        setVideoTrack(track);
        setOriginalVideoStart(0); // Store original position
        // Update total duration after setting video track
        setTimeout(updateTotalDuration, 0);
        // Revoke the temporary URL used for metadata loading
        URL.revokeObjectURL(tempUrl);
      });
      video.src = tempUrl;
    } else {
      setVideoDuration(0);
      setVideoTrack(null);
    }
  };

  // Audio file selection
  const onAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setAudioFile(file);
    
    // Clean up previous audio preview URL
    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
      setAudioPreviewUrl("");
    }
    
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setAudioPreviewUrl(previewUrl); // Store for preview player
      
      // Create a separate temporary URL for metadata loading
      const tempUrl = URL.createObjectURL(file);
      const audio = new Audio();
      audio.addEventListener('loadedmetadata', () => {
        setAudioDuration(audio.duration);
        const track: AudioTrackSimple = {
          id: generateId(),
          file,
          startTime: 0,
          duration: audio.duration,
          name: file.name
        };
        setAudioTrack(track);
        setOriginalAudioStart(0); // Store original position
        // Update total duration after setting audio track
        setTimeout(updateTotalDuration, 0);
        // Revoke the temporary URL used for metadata loading
        URL.revokeObjectURL(tempUrl);
      });
      audio.src = tempUrl;
    } else {
      setAudioDuration(0);
      setAudioTrack(null);
    }
  };

  // Upload video to ComfyUI
  async function uploadVideoToComfy(baseUrl: string, file: File): Promise<string> {
    const form = new FormData();
    form.append("image", file, file.name); // ComfyUI uses "image" field for all media

    try {
      const r = await fetch(`${baseUrl}/upload/image`, {
        method: "POST",
        body: form,
        credentials: "omit",
      });
      
      if (!r.ok) {
        throw new Error(`Upload failed: HTTP ${r.status}`);
      }

      let data: any = null;
      try { 
        data = await r.json(); 
      } catch { 
        // May be plain text
      }
      
      if (data?.name) return data.name as string;
      if (Array.isArray(data?.files) && data.files[0]) return data.files[0] as string;
      
      const text = typeof data === "string" ? data : await r.text().catch(() => "");
      if (text.trim()) return text.trim();
      
      throw new Error("Unexpected server response");
      
    } catch (e: any) {
      if (e.name === 'TypeError' && e.message.includes('fetch')) {
        throw new Error('Could not connect to server. Check the ngrok URL.');
      }
      throw new Error(`Could not upload video: ${e.message}`);
    }
  }

  // Build workflow JSON
  async function buildPromptJSON(videoFilename: string, audioFilename: string) {
    try {
      const response = await fetch('/workflows/VideoLipsync.json');
      if (!response.ok) {
        throw new Error('Failed to load workflow template');
      }
      const template = await response.json();
      
      // Calculate timing parameters
      const audioStartTime = audioTrack ? `${Math.floor(audioTrack.startTime / 60)}:${String(Math.floor(audioTrack.startTime % 60)).padStart(2, '0')}` : "0:00";
      const audioEndTime = audioTrack ? `${Math.floor((audioTrack.startTime + audioTrack.duration) / 60)}:${String(Math.ceil((audioTrack.startTime + audioTrack.duration) % 60)).padStart(2, '0')}` : "2:00";
      const videoStartFrame = videoTrack ? Math.floor(videoTrack.startTime * 25) : 0; // Assuming 25 FPS
      
      // Calculate black frame padding based on timeline union
      const fps = 25;
      const videoStartTime = videoTrack ? videoTrack.startTime : 0;
      const audioStartTime_seconds = audioTrack ? audioTrack.startTime : 0;
      const videoEndTime = videoTrack ? videoTrack.startTime + videoTrack.duration : 0;
      const audioEndTime_seconds = audioTrack ? audioTrack.startTime + audioTrack.duration : 0;
      
      // Calculate black frames needed to cover gaps
      // Black frames at start: if audio starts before video
      const blackFramesStart = videoTrack && audioTrack && audioStartTime_seconds < videoStartTime 
        ? Math.floor((videoStartTime - audioStartTime_seconds) * fps) 
        : 0;
      
      // Black frames at end: if audio continues after video ends
      const blackFramesEnd = videoTrack && audioTrack && audioEndTime_seconds > videoEndTime 
        ? Math.floor((audioEndTime_seconds - videoEndTime) * fps) 
        : 0;
      
      // Determine concatenation inputs based on black frame needs
      // ImageConcatMulti requires minimum 2 inputs, so we need to handle the single input case differently
      let concatInputCount = 2; // Minimum for ImageConcatMulti
      let concatInput1Node = "301"; // Generated video frames (main output from lipsync)
      let concatInput1Index = "0";
      let concatInput2Node = "301"; // Fallback to main output
      let concatInput2Index = "0";
      let concatInput3Node = "301"; // Fallback to main output
      let concatInput3Index = "0";
      
      if (blackFramesStart > 0 && blackFramesEnd > 0) {
        // Need black frames at both start and end: [black_start, generated_video, black_end]
        concatInputCount = 3;
        concatInput1Node = "311"; // Start black frames
        concatInput1Index = "0";
        concatInput2Node = "301"; // Generated lipsync video frames
        concatInput2Index = "0"; 
        concatInput3Node = "313"; // End black frames
        concatInput3Index = "0";
      } else if (blackFramesStart > 0) {
        // Need black frames only at start: [black_start, generated_video]
        concatInputCount = 2;
        concatInput1Node = "311"; // Start black frames
        concatInput1Index = "0";
        concatInput2Node = "301"; // Generated lipsync video frames
        concatInput2Index = "0";
      } else if (blackFramesEnd > 0) {
        // Need black frames only at end: [generated_video, black_end]
        concatInputCount = 2;
        concatInput1Node = "301"; // Generated lipsync video frames
        concatInput1Index = "0";
        concatInput2Node = "313"; // End black frames
        concatInput2Index = "0";
      } else {
        // No black frames needed: duplicate main output to satisfy ImageConcatMulti minimum requirement
        concatInputCount = 2;
        concatInput1Node = "301"; // Generated lipsync video frames
        concatInput1Index = "0";
        concatInput2Node = "301"; // Same frames duplicated
        concatInput2Index = "0";
      }

      const promptString = JSON.stringify(template)
        .replace(/"\{\{VIDEO_FILENAME\}\}"/g, `"${videoFilename}"`)
        .replace(/"\{\{AUDIO_FILENAME\}\}"/g, `"${audioFilename}"`)
        .replace(/"\{\{WIDTH\}\}"/g, width.toString())
        .replace(/"\{\{HEIGHT\}\}"/g, height.toString())
        .replace(/"\{\{AUDIO_SCALE\}\}"/g, audioScale.toString())
        .replace(/"\{\{AUDIO_START_TIME\}\}"/g, `"${audioStartTime}"`)
        .replace(/"\{\{AUDIO_END_TIME\}\}"/g, `"${audioEndTime}"`)
        .replace(/"\{\{VIDEO_START_FRAME\}\}"/g, videoStartFrame.toString())
        .replace(/"\{\{CUSTOM_PROMPT\}\}"/g, `"${customPrompt.replace(/"/g, '\\"')}"`)
        .replace(/"\{\{TRIM_TO_AUDIO\}\}"/g, trimToAudio.toString())
        // Black frame parameters
        .replace(/"\{\{BLACK_FRAME_COUNT_START\}\}"/g, blackFramesStart.toString())
        .replace(/"\{\{BLACK_FRAME_COUNT_END\}\}"/g, blackFramesEnd.toString())
        // Concatenation parameters
        .replace(/"\{\{CONCAT_INPUT_COUNT\}\}"/g, concatInputCount.toString())
        .replace(/"\{\{CONCAT_INPUT_1_NODE\}\}"/g, `"${concatInput1Node}"`)
        .replace(/"\{\{CONCAT_INPUT_1_INDEX\}\}"/g, concatInput1Index)
        .replace(/"\{\{CONCAT_INPUT_2_NODE\}\}"/g, `"${concatInput2Node}"`)
        .replace(/"\{\{CONCAT_INPUT_2_INDEX\}\}"/g, concatInput2Index)
        .replace(/"\{\{CONCAT_INPUT_3_NODE\}\}"/g, `"${concatInput3Node}"`)
        .replace(/"\{\{CONCAT_INPUT_3_INDEX\}\}"/g, concatInput3Index);
      
      
      return JSON.parse(promptString);
    } catch {
      throw new Error('Failed to build prompt JSON');
    }
  }

  // Submit job
  async function submit() {
    setStatus('');
    setVideoUrl('');
    setJobId('');

    if (!comfyUrl) {
      setStatus('Enter ComfyUI URL.');
      return;
    }
    if (!videoFile) {
      setStatus('Upload a video.');
      return;
    }
    if (!audioFile) {
      setStatus('Upload an audio file.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Check ComfyUI health
      setStatus('Checking ComfyUI...');
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      setStatus('Uploading video to ComfyUI…');
      const videoFilename = await uploadVideoToComfy(comfyUrl, videoFile);

      setStatus('Uploading audio to ComfyUI…');
      const audioFilename = await uploadMediaToComfy(comfyUrl, audioFile);

      setStatus('Sending prompt to ComfyUI…');
      const payload = {
        prompt: await buildPromptJSON(videoFilename, audioFilename),
        client_id: `video-lipsync-${generateId()}`,
      };

      let r: Response;
      try {
        r = await fetch(`${comfyUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000)
        });
      } catch (error: any) {
        if (error.name === 'TimeoutError') {
          throw new Error('Timeout connecting to ComfyUI. Check that it\'s running and the URL is correct.');
        }
        if (error.name === 'TypeError') {
          throw new Error('Could not connect to ComfyUI. Check URL and that CORS is enabled.');
        }
        throw new Error(`Network error: ${error.message}`);
      }
      
      if (!r.ok) {
        let errorDetail = '';
        try {
          const errorData = await r.json();
          errorDetail = errorData.error || errorData.message || '';
        } catch {
          errorDetail = await r.text().catch(() => '');
        }
        throw new Error(`ComfyUI rejected the prompt (${r.status}): ${errorDetail || 'Unknown error'}`);
      }
      
      const resp = await r.json();
      const id = resp?.prompt_id || resp?.promptId || resp?.node_id || "";
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID. Response: ' + JSON.stringify(resp));
      }
      setJobId(id);

      // Create job record in new video_jobs table
      await apiClient.createVideoJob({
        comfy_job_id: id,
        workflow_name: 'video-lipsync',
        comfy_url: comfyUrl,
        input_video_urls: [videoFile.name],
        input_audio_urls: [audioFilename],
        width,
        height,
        fps: 25,
        parameters: {
          audio_scale: audioScale,
          trim_to_audio: trimToAudio,
          has_video: !!videoTrack,
          has_audio: !!audioTrack
        }
      });

      await apiClient.updateVideoJobToProcessing(id);

      // Start monitoring job status
      setStatus('Processing in ComfyUI…');
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, videoInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing in ComfyUI…');
          } else if (jobStatus === 'completed' && videoInfo) {
            setStatus('Processing completed');
            // Set ComfyUI URL as fallback - the job monitoring will handle Supabase upload
            const fallbackUrl = videoInfo.subfolder
              ? `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=${videoInfo.type || 'output'}`
              : `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=${videoInfo.type || 'output'}`;
            setVideoUrl(fallbackUrl);

            setStatus('Ready ✅');
            setIsSubmitting(false);

            // Complete job in new system
            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'completed',
              output_video_urls: [fallbackUrl]
            });

          } else if (jobStatus === 'error') {
            setStatus(`❌ ${message}`);
            setIsSubmitting(false);

            try {
              await apiClient.completeVideoJob(id, {
                job_id: id,
                status: 'failed',
                error_message: message || 'Unknown error'
              });
            } catch {
              // Silent error - job status update failed
            }
          }
        }
      );
      
      setJobMonitorCleanup(() => cleanup);
    } catch (e: any) {
      let errorMessage = e?.message || String(e);
      
      if (errorMessage.includes('Failed to fetch')) {
        errorMessage = 'Could not connect to ComfyUI. Check URL and that it\'s running.';
      } else if (errorMessage.includes('NetworkError')) {
        errorMessage = 'Network error connecting to ComfyUI. Check your connection.';
      } else if (errorMessage.includes('JSON.parse')) {
        errorMessage = 'ComfyUI returned an invalid response. It may be overloaded.';
      } else if (errorMessage.includes('workflow template')) {
        errorMessage = 'Error loading workflow template. Check that the file exists.';
      }
      
      setStatus(`❌ ${errorMessage}`);
      
      if (jobId) {
        try {
          await apiClient.completeVideoJob(jobId, {
            job_id: jobId,
            status: 'failed',
            error_message: errorMessage
          });
        } catch {
          // Silent error - job status update failed but main error is more important
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // Timeline helpers
  const updateVideoTrackTime = (id: string, startTime: number) => {
    if (videoTrack && videoTrack.id === id) {
      const updatedTrack = { ...videoTrack, startTime: Math.max(0, startTime) };
      setVideoTrack(updatedTrack);
      // Update total duration automatically based on content coverage
      setTimeout(updateTotalDuration, 0);
    }
  };

  const updateAudioTrackTime = (id: string, startTime: number) => {
    if (audioTrack && audioTrack.id === id) {
      const updatedTrack = { ...audioTrack, startTime: Math.max(0, startTime) };
      setAudioTrack(updatedTrack);
      // Update total duration automatically based on content coverage
      setTimeout(updateTotalDuration, 0);
    }
  };

  const removeVideoTrack = () => {
    setVideoTrack(null);
    setVideoFile(null);
    setVideoPreview("");
    setVideoDuration(0);
    if (videoInputRef.current) videoInputRef.current.value = '';
    // Update total duration after removing video track
    setTimeout(updateTotalDuration, 0);
  };

  const removeAudioTrack = () => {
    setAudioTrack(null);
    setAudioFile(null);
    setAudioDuration(0);
    if (audioInputRef.current) audioInputRef.current.value = '';
    // Update total duration after removing audio track
    setTimeout(updateTotalDuration, 0);
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = "video-lipsync.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-green-600 via-blue-600 to-purple-600 bg-clip-text text-transparent">
              Video Lipsync
            </h1>
            <div className="text-lg md:text-xl font-medium text-gray-700">
              <span className="bg-gradient-to-r from-green-100 to-blue-100 px-4 py-2 rounded-full border border-green-200/50">
                Audio & Video Sync
              </span>
            </div>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Sync audio with existing video using advanced lipsync technology.
            </p>
          </div>

          <Section title="Configuración">
            <Field>
              <Label>Prompt personalizado</Label>
              <textarea
                rows={3}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all duration-200 bg-white/80 resize-vertical"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Describe what the person is doing..."
              />
              <p className="text-xs text-gray-500 mt-1">Description of what the person should be doing in the video</p>
            </Field>
            
            <div className="mt-4 grid md:grid-cols-2 gap-4">
              <Field>
                <Label>Audio Scale</Label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="3.0"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all duration-200 bg-white/80"
                  value={audioScale}
                  onChange={(e) => setAudioScale(Number(e.target.value))}
                />
                <p className="text-xs text-gray-500 mt-1">Audio intensity scale (0.1 - 3.0)</p>
              </Field>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Width (px)</Label>
                  <input
                    type="number"
                    className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all duration-200 bg-white/80"
                    value={widthInput}
                    onChange={(e) => handleWidthChange(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">Auto-corrects to multiple of 32 after 2s</p>
                </div>
                <div>
                  <Label>Height (px)</Label>
                  <input
                    type="number"
                    className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all duration-200 bg-white/80"
                    value={heightInput}
                    onChange={(e) => handleHeightChange(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">Auto-corrects to multiple of 32 after 2s</p>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Media Upload">
            <div className="grid md:grid-cols-2 gap-6">
              <Field>
                <Label>Video Source</Label>
                <div className="relative">
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    onChange={onVideoSelect}
                    className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-green-500 file:to-blue-600 file:text-white file:font-semibold hover:file:from-green-600 hover:file:to-blue-700 transition-all duration-200 bg-gray-50/50"
                  />
                </div>
                {videoPreview && (
                  <div className="mt-3">
                    <video src={videoPreview} controls className="w-full rounded-2xl shadow-lg border border-gray-200" />
                  </div>
                )}
                {videoDuration > 0 && (
                  <p className="text-xs text-green-600 mt-1">Duration: {videoDuration.toFixed(1)}s</p>
                )}
              </Field>
              
              <Field>
                <Label>Audio Source</Label>
                <div className="relative">
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={onAudioSelect}
                    className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50"
                  />
                </div>
                {audioDuration > 0 && (
                  <p className="text-xs text-blue-600 mt-1">Duration: {audioDuration.toFixed(1)}s</p>
                )}
              </Field>
            </div>
          </Section>

          <Section title="Timeline Sync">
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Drag the colored blocks on the timeline to adjust when your video and audio start playing. Black frames will be added automatically where video isn't active.
              </p>
              <Timeline
                tracks={[
                  ...(videoTrack ? [{ ...videoTrack, assignedMaskId: null }] : []),
                  ...(audioTrack ? [{ ...audioTrack, assignedMaskId: null }] : [])
                ]}
                totalDuration={totalDuration}
                onUpdateTrackTime={(id, startTime) => {
                  if (videoTrack && videoTrack.id === id) {
                    updateVideoTrackTime(id, startTime);
                  } else if (audioTrack && audioTrack.id === id) {
                    updateAudioTrackTime(id, startTime);
                  }
                }}
                onRemoveTrack={(id) => {
                  if (videoTrack && videoTrack.id === id) {
                    removeVideoTrack();
                  } else if (audioTrack && audioTrack.id === id) {
                    removeAudioTrack();
                  }
                }}
                onUpdateTotalDuration={updateTotalDuration}
              />
              
              <div className="space-y-4">
                {/* Quick Timeline Presets */}
                {videoTrack && audioTrack && (
                  <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="font-medium text-gray-800 mb-2">⚡ Quick Timing Presets</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                          updateVideoTrackTime(videoTrack.id, 0);
                          updateAudioTrackTime(audioTrack.id, 0);
                        }}
                        className="px-3 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
                      >
                        Both at Start
                      </button>
                      <button
                        onClick={() => {
                          updateAudioTrackTime(audioTrack.id, 0);
                          updateVideoTrackTime(videoTrack.id, 2);
                        }}
                        className="px-3 py-1 text-xs bg-blue-200 hover:bg-blue-300 rounded-lg transition-colors"
                      >
                        Audio First (+2s video)
                      </button>
                      <button
                        onClick={() => {
                          updateVideoTrackTime(videoTrack.id, 0);
                          updateAudioTrackTime(audioTrack.id, 1);
                        }}
                        className="px-3 py-1 text-xs bg-green-200 hover:bg-green-300 rounded-lg transition-colors"
                      >
                        Video First (+1s audio)
                      </button>
                      <button
                        onClick={() => {
                          updateVideoTrackTime(videoTrack.id, originalVideoStart);
                          updateAudioTrackTime(audioTrack.id, originalAudioStart);
                        }}
                        className="px-3 py-1 text-xs bg-gray-300 hover:bg-gray-400 rounded-lg transition-colors"
                      >
                        Reset Original
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                    <div className="font-medium text-green-800 mb-1">🎬 Video Track</div>
                    <div className="text-green-600">
                      {videoTrack ? `${videoTrack.name} (${videoTrack.duration.toFixed(1)}s)` : 'No video uploaded'}
                      {videoTrack && (
                        <div className="text-xs mt-1">
                          Start: {videoTrack.startTime.toFixed(1)}s
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <div className="font-medium text-blue-800 mb-1">🎵 Audio Track</div>
                    <div className="text-blue-600">
                      {audioTrack ? `${audioTrack.name} (${audioTrack.duration.toFixed(1)}s)` : 'No audio uploaded'}
                      {audioTrack && (
                        <div className="text-xs mt-1">
                          Start: {audioTrack.startTime.toFixed(1)}s
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Auto-padding info */}
                {videoTrack && audioTrack && (
                  <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                    <div className="font-medium text-yellow-800 mb-1">⚡ Auto Padding</div>
                    <div className="text-yellow-600 text-xs">
                      {(() => {
                        const fps = 25;
                        const videoStartTime = videoTrack.startTime;
                        const audioStartTime = audioTrack.startTime;
                        const videoEndTime = videoTrack.startTime + videoTrack.duration;
                        const audioEndTime = audioTrack.startTime + audioTrack.duration;
                        const blackFramesStart = Math.max(0, Math.floor((videoStartTime - audioStartTime) * fps));
                        const blackFramesEnd = Math.max(0, Math.floor((audioEndTime - videoEndTime) * fps));
                        
                        if (blackFramesStart > 0 && blackFramesEnd > 0) {
                          return `Adding ${blackFramesStart} black frames at start, ${blackFramesEnd} at end`;
                        } else if (blackFramesStart > 0) {
                          return `Adding ${blackFramesStart} black frames at start`;
                        } else if (blackFramesEnd > 0) {
                          return `Adding ${blackFramesEnd} black frames at end`;
                        } else {
                          return 'No padding needed - perfect sync';
                        }
                      })()}
                    </div>
                  </div>
                )}
                
                <div className="p-2 rounded bg-gray-100 text-xs text-gray-600">
                  <strong>Final Duration:</strong> {totalDuration}s 
                  {videoTrack && audioTrack ? ' (union of video + audio timeline)' : 
                   videoTrack && !audioTrack ? ' (video duration minimum)' : 
                   !videoTrack && audioTrack ? ' (audio coverage only)' : 
                   ' (default minimum)'}
                </div>
              </div>
            </div>
          </Section>

          {/* Timeline Preview with Black Frame Padding */}
          {videoFile && audioFile && videoPreview && audioPreviewUrl && (
            <Section title="Timeline Preview">
              <div className="space-y-6">
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <div className="font-medium text-blue-800 mb-1">📺 Live Preview</div>
                  <p className="text-blue-600 text-sm">
                    This preview shows exactly how your final video will look with automatic black frame padding. 
                    Use the timeline above to drag tracks and adjust timing - changes appear instantly here.
                  </p>
                </div>

                {/* Live Preview Player */}
                <AVPlayerWithPadding
                  videoSrc={videoPreview}
                  audioSrc={audioPreviewUrl}
                  videoStart={videoTrack?.startTime || 0}
                  videoDuration={videoTrack?.duration}
                  audioStart={audioTrack?.startTime || 0}
                  audioDuration={audioTrack?.duration}
                  viewportSize={{ width: width, height: height }}
                  className="max-w-2xl mx-auto"
                  onTimeUpdate={() => {
                    // Optional: could sync with timeline visualization
                  }}
                />
                
                {/* Enhanced Info Panel */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <div className="font-medium text-blue-800 mb-1">📖 How it works</div>
                    <div className="text-blue-600 text-sm space-y-1">
                      <p>• <strong>Green bar:</strong> Video is active and visible</p>
                      <p>• <strong>Blue bar:</strong> Audio is playing</p>
                      <p>• <strong>Black areas:</strong> Auto padding where video isn't active</p>
                      <p>• <strong>Drag tracks:</strong> Use timeline above to adjust timing</p>
                    </div>
                  </div>
                  
                  <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                    <div className="font-medium text-yellow-800 mb-1">⏱️ Current Timeline</div>
                    <div className="text-yellow-700 text-sm space-y-1">
                      <p>• <strong>Video:</strong> {(videoTrack?.startTime || 0).toFixed(1)}s → {((videoTrack?.startTime || 0) + (videoTrack?.duration || 0)).toFixed(1)}s</p>
                      <p>• <strong>Audio:</strong> {(audioTrack?.startTime || 0).toFixed(1)}s → {((audioTrack?.startTime || 0) + (audioTrack?.duration || 0)).toFixed(1)}s</p>
                      <p>• <strong>Total:</strong> {calculateFinalDuration().toFixed(1)}s</p>
                      {(() => {
                        const vStart = videoTrack?.startTime || 0;
                        const aStart = audioTrack?.startTime || 0;
                        const vEnd = vStart + (videoTrack?.duration || 0);
                        const aEnd = aStart + (audioTrack?.duration || 0);
                        const blackStart = aStart < vStart ? (vStart - aStart).toFixed(1) : '0';
                        const blackEnd = aEnd > vEnd ? (aEnd - vEnd).toFixed(1) : '0';
                        return (
                          <p>• <strong>Black padding:</strong> {blackStart}s start, {blackEnd}s end</p>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </Section>
          )}

          <Section title="Generation">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-green-600 to-blue-600 text-white font-bold text-lg shadow-lg hover:from-green-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={submit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing…
                  </>
                ) : (
                  <>
                    <span>🎬</span>
                    Generate Lipsync
                  </>
                )}
              </button>
              {jobId && <span className="text-xs text-gray-500">Job ID: {jobId}</span>}
              {status && <span className="text-sm">{status}</span>}
            </div>

            {videoUrl && (
              <div className="mt-6 space-y-3">
                <video src={videoUrl} controls className="w-full rounded-3xl shadow-2xl border border-gray-200/50" />
                <div>
                  <button className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2" onClick={handleDownload}>
                    <span>⬇️</span>
                    Download MP4
                  </button>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Right Sidebar - Video Feed */}
        <div className="w-96 space-y-6">
          <div className="sticky top-6 h-[calc(100vh-3rem)]">
            <VideoFeed
              comfyUrl={comfyUrl}
              config={{
                useNewJobSystem: true,
                workflowName: 'video-lipsync',
                showCompletedOnly: false,
                maxItems: 10,
                showFixButton: true,
                showProgress: true,
                pageContext: 'video-lipsync'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}