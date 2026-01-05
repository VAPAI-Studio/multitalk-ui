import React, { useEffect, useRef, useState } from "react";
import { Label, Field, Section } from "../components/UI";
import { Button, Badge } from "../components/DesignSystem";
import { Timeline } from "../components/Timeline";
import type { Mask, AudioTrack, VideoTrack, AudioTrackSimple } from "../components/types";
import { fileToBase64, uploadMediaToComfy, joinAudiosForMask, groupAudiosByMask, generateId, startJobMonitoring, checkComfyUIHealth } from "../components/utils";
import GenerationFeed from "../components/GenerationFeed";
import { useSmartResolution } from "../hooks/useSmartResolution";
import { MaskEditor } from "../components/MaskEditor";
import { AVPlayerWithPadding } from "../components/AVPlayerWithPadding";
import { apiClient } from "../lib/apiClient";

// Types for different lipsync modes
type LipsyncMode = 'one-person' | 'multi-person' | 'video-lipsync';

interface Props {
  comfyUrl: string;
  initialMode?: LipsyncMode;
}

// Tab button component
function TabButton({
  mode,
  currentMode,
  onClick,
  icon,
  label,
  gradient
}: {
  mode: LipsyncMode;
  currentMode: LipsyncMode;
  onClick: () => void;
  icon: string;
  label: string;
  gradient: string;
}) {
  const isActive = mode === currentMode;
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
        isActive
          ? `bg-gradient-to-r ${gradient} text-white shadow-lg`
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      <span className="text-lg">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export default function Lipsync({ comfyUrl, initialMode = 'one-person' }: Props) {
  // Mode selection
  const [activeMode, setActiveMode] = useState<LipsyncMode>(initialMode);

  // ===== SHARED STATE =====
  const [status, setStatus] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [jobMonitorCleanup, setJobMonitorCleanup] = useState<(() => void) | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('a person is speaking');

  // Resolution - shared across all modes
  const {
    width,
    height,
    widthInput,
    heightInput,
    handleWidthChange,
    handleHeightChange,
    setWidth,
    setHeight
  } = useSmartResolution(640, 360);

  // ===== ONE-PERSON STATE =====
  const [onePersonImageFile, setOnePersonImageFile] = useState<File | null>(null);
  const [onePersonAudioFile, setOnePersonAudioFile] = useState<File | null>(null);
  const [onePersonImagePreview, setOnePersonImagePreview] = useState<string>("");
  const [onePersonImageAR, setOnePersonImageAR] = useState<number | null>(null);
  const [onePersonAudioDuration, setOnePersonAudioDuration] = useState<number>(0);
  const [onePersonWorkflowMode, setOnePersonWorkflowMode] = useState<'multitalk' | 'infinitetalk'>('multitalk');
  const [onePersonAudioScale, setOnePersonAudioScale] = useState<number>(1);

  // ===== MULTI-PERSON STATE =====
  const [multiPersonImageFile, setMultiPersonImageFile] = useState<File | null>(null);
  const [multiPersonMasks, setMultiPersonMasks] = useState<Mask[]>([]);
  const [multiPersonAudioTracks, setMultiPersonAudioTracks] = useState<AudioTrack[]>([]);
  const [multiPersonImagePreview, setMultiPersonImagePreview] = useState<string>("");
  const [multiPersonImageAR, setMultiPersonImageAR] = useState<number | null>(null);
  const [multiPersonTotalDuration, setMultiPersonTotalDuration] = useState<number>(10);
  const [multiPersonIsEditingMask, setMultiPersonIsEditingMask] = useState<string | null>(null);
  const [multiPersonShowMaskModal, setMultiPersonShowMaskModal] = useState<boolean>(false);

  // ===== VIDEO-LIPSYNC STATE =====
  const [videoLipsyncVideoFile, setVideoLipsyncVideoFile] = useState<File | null>(null);
  const [videoLipsyncAudioFile, setVideoLipsyncAudioFile] = useState<File | null>(null);
  const [videoLipsyncVideoPreview, setVideoLipsyncVideoPreview] = useState<string>("");
  const [videoLipsyncVideoDuration, setVideoLipsyncVideoDuration] = useState<number>(0);
  const [videoLipsyncAudioDuration, setVideoLipsyncAudioDuration] = useState<number>(0);
  const [videoLipsyncAudioScale, setVideoLipsyncAudioScale] = useState<number>(1.5);
  const [videoLipsyncVideoTrack, setVideoLipsyncVideoTrack] = useState<VideoTrack | null>(null);
  const [videoLipsyncAudioTrack, setVideoLipsyncAudioTrack] = useState<AudioTrackSimple | null>(null);
  const [videoLipsyncTotalDuration, setVideoLipsyncTotalDuration] = useState<number>(10);
  const [videoLipsyncAudioPreviewUrl, setVideoLipsyncAudioPreviewUrl] = useState<string>("");
  const [videoLipsyncOriginalVideoStart, setVideoLipsyncOriginalVideoStart] = useState<number>(0);
  const [videoLipsyncOriginalAudioStart, setVideoLipsyncOriginalAudioStart] = useState<number>(0);

  // Refs
  const onePersonImgRef = useRef<HTMLImageElement | null>(null);
  const multiPersonFileInputRef = useRef<HTMLInputElement | null>(null);
  const videoLipsyncVideoInputRef = useRef<HTMLInputElement | null>(null);
  const videoLipsyncAudioInputRef = useRef<HTMLInputElement | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (jobMonitorCleanup) {
        jobMonitorCleanup();
      }
      if (videoLipsyncAudioPreviewUrl) {
        URL.revokeObjectURL(videoLipsyncAudioPreviewUrl);
      }
      if (videoLipsyncVideoPreview) {
        URL.revokeObjectURL(videoLipsyncVideoPreview);
      }
      if (onePersonImagePreview) {
        URL.revokeObjectURL(onePersonImagePreview);
      }
      if (multiPersonImagePreview) {
        URL.revokeObjectURL(multiPersonImagePreview);
      }
    };
  }, [jobMonitorCleanup, videoLipsyncAudioPreviewUrl, videoLipsyncVideoPreview, onePersonImagePreview, multiPersonImagePreview]);

  // ===== ONE-PERSON EFFECTS =====
  useEffect(() => {
    if (!onePersonImageFile) return;
    const url = URL.createObjectURL(onePersonImageFile);
    setOnePersonImagePreview(url);
    const img = new Image();
    img.onload = () => {
      const ar = img.width / img.height;
      setOnePersonImageAR(ar);
      const targetW = Math.max(32, Math.round(Math.min(640, img.width) / 32) * 32);
      const targetH = Math.max(32, Math.round((targetW / ar) / 32) * 32);
      setWidth(targetW);
      setHeight(targetH);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [onePersonImageFile]);

  useEffect(() => {
    if (!onePersonImageAR || activeMode !== 'one-person') return;
    const targetH = Math.max(32, Math.round((width / onePersonImageAR) / 32) * 32);
    if (targetH !== height) setHeight(targetH);
  }, [width, onePersonImageAR, activeMode]);

  // ===== MULTI-PERSON EFFECTS =====
  useEffect(() => {
    if (!multiPersonImageFile) { setMultiPersonImagePreview(''); setMultiPersonImageAR(null); return; }
    const url = URL.createObjectURL(multiPersonImageFile);
    setMultiPersonImagePreview(url);
    const img = new Image();
    img.onload = () => {
      const ar = img.width / img.height;
      setMultiPersonImageAR(ar);
      const w = Math.max(32, Math.round(Math.min(1280, img.width) / 32) * 32);
      const h = Math.max(32, Math.round((w / ar) / 32) * 32);
      setWidth(w); setHeight(h);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [multiPersonImageFile]);

  useEffect(() => {
    if (multiPersonImageAR && activeMode === 'multi-person') {
      const h = Math.max(32, Math.round((width / multiPersonImageAR) / 32) * 32);
      if (h !== height) setHeight(h);
    }
  }, [width, multiPersonImageAR, activeMode, height]);

  // ===== HELPER FUNCTIONS =====

  // One-person file to base64
  async function onePersonFileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        const base64 = res.includes(",") ? res.split(",")[1] : res;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Multi-person masks CRUD
  const createMask = () => {
    const m: Mask = { id: generateId(), name: `Mask ${multiPersonMasks.length + 1}`, maskData: null };
    setMultiPersonMasks(v => [...v, m]);
    setMultiPersonIsEditingMask(m.id);
    setMultiPersonShowMaskModal(true);
  };

  const deleteMask = (id: string) => {
    setMultiPersonMasks(v => v.filter(m => m.id !== id));
    setMultiPersonAudioTracks(v => v.map(t => (t.assignedMaskId === id ? { ...t, assignedMaskId: null } : t)));
  };

  const updateMask = (id: string, data: string | null) =>
    setMultiPersonMasks(v => v.map(m => (m.id === id ? { ...m, maskData: data } : m)));

  const assignMask = (trackId: string, maskId: string | null) =>
    setMultiPersonAudioTracks(v => v.map(t => (t.id === trackId ? { ...t, assignedMaskId: maskId } : t)));

  // Multi-person audio tracks
  const addAudioClick = () => multiPersonFileInputRef.current?.click();

  const onMultiPersonAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const el = new Audio();
      const url = URL.createObjectURL(file);
      el.addEventListener('loadedmetadata', () => {
        const track: AudioTrack = { id: generateId(), file, startTime: 0, duration: el.duration || 0, name: file.name, assignedMaskId: null };
        setMultiPersonAudioTracks(prev => {
          const next = [...prev, track];
          const req = Math.ceil(Math.max(...next.map(t => t.startTime + t.duration)));
          if (req > multiPersonTotalDuration) setMultiPersonTotalDuration(req);
          return next;
        });
        URL.revokeObjectURL(url);
      });
      el.src = url;
    });
    if (e.target) e.target.value = '';
  };

  const removeMultiPersonTrack = (id: string) => setMultiPersonAudioTracks(prev => {
    const next = prev.filter(t => t.id !== id);
    if (!next.length) setMultiPersonTotalDuration(10);
    else setMultiPersonTotalDuration(Math.ceil(Math.max(...next.map(t => t.startTime + t.duration))));
    return next;
  });

  const updateMultiPersonTrackStart = (id: string, start: number) => setMultiPersonAudioTracks(prev => {
    const next = prev.map(t => (t.id === id ? { ...t, startTime: Math.max(0, start) } : t));
    const pick = next.find(t => t.id === id);
    if (pick) {
      const reqEnd = pick.startTime + pick.duration;
      if (reqEnd > multiPersonTotalDuration) setMultiPersonTotalDuration(Math.ceil(reqEnd));
    }
    return next;
  });

  // Video lipsync duration calculation
  const calculateVideoLipsyncFinalDuration = () => {
    if (!videoLipsyncVideoTrack && !videoLipsyncAudioTrack) return 10;

    let latestEnd = 0;

    if (videoLipsyncVideoTrack) {
      latestEnd = Math.max(latestEnd, videoLipsyncVideoTrack.startTime + videoLipsyncVideoTrack.duration);
    }

    if (videoLipsyncAudioTrack) {
      latestEnd = Math.max(latestEnd, videoLipsyncAudioTrack.startTime + videoLipsyncAudioTrack.duration);
    }

    if (videoLipsyncVideoTrack && !videoLipsyncAudioTrack) {
      return Math.ceil(videoLipsyncVideoTrack.duration);
    }

    const minimumDuration = videoLipsyncVideoTrack ? videoLipsyncVideoTrack.duration : 0;
    return Math.ceil(Math.max(latestEnd, minimumDuration));
  };

  const updateVideoLipsyncTotalDuration = () => {
    const newDuration = calculateVideoLipsyncFinalDuration();
    setVideoLipsyncTotalDuration(newDuration);
  };

  // Video lipsync file handlers
  const onVideoLipsyncVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setVideoLipsyncVideoFile(file);

    if (videoLipsyncVideoPreview) {
      URL.revokeObjectURL(videoLipsyncVideoPreview);
      setVideoLipsyncVideoPreview("");
    }

    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setVideoLipsyncVideoPreview(previewUrl);

      const tempUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.addEventListener('loadedmetadata', () => {
        setVideoLipsyncVideoDuration(video.duration);
        const track: VideoTrack = {
          id: generateId(),
          file,
          startTime: 0,
          duration: video.duration,
          name: file.name
        };
        setVideoLipsyncVideoTrack(track);
        setVideoLipsyncOriginalVideoStart(0);
        setTimeout(updateVideoLipsyncTotalDuration, 0);
        URL.revokeObjectURL(tempUrl);
      });
      video.src = tempUrl;
    } else {
      setVideoLipsyncVideoDuration(0);
      setVideoLipsyncVideoTrack(null);
    }
  };

  const onVideoLipsyncAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setVideoLipsyncAudioFile(file);

    if (videoLipsyncAudioPreviewUrl) {
      URL.revokeObjectURL(videoLipsyncAudioPreviewUrl);
      setVideoLipsyncAudioPreviewUrl("");
    }

    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setVideoLipsyncAudioPreviewUrl(previewUrl);

      const tempUrl = URL.createObjectURL(file);
      const audio = new Audio();
      audio.addEventListener('loadedmetadata', () => {
        setVideoLipsyncAudioDuration(audio.duration);
        const track: AudioTrackSimple = {
          id: generateId(),
          file,
          startTime: 0,
          duration: audio.duration,
          name: file.name
        };
        setVideoLipsyncAudioTrack(track);
        setVideoLipsyncOriginalAudioStart(0);
        setTimeout(updateVideoLipsyncTotalDuration, 0);
        URL.revokeObjectURL(tempUrl);
      });
      audio.src = tempUrl;
    } else {
      setVideoLipsyncAudioDuration(0);
      setVideoLipsyncAudioTrack(null);
    }
  };

  const updateVideoLipsyncVideoTrackTime = (id: string, startTime: number) => {
    if (videoLipsyncVideoTrack && videoLipsyncVideoTrack.id === id) {
      const updatedTrack = { ...videoLipsyncVideoTrack, startTime: Math.max(0, startTime) };
      setVideoLipsyncVideoTrack(updatedTrack);
      setTimeout(updateVideoLipsyncTotalDuration, 0);
    }
  };

  const updateVideoLipsyncAudioTrackTime = (id: string, startTime: number) => {
    if (videoLipsyncAudioTrack && videoLipsyncAudioTrack.id === id) {
      const updatedTrack = { ...videoLipsyncAudioTrack, startTime: Math.max(0, startTime) };
      setVideoLipsyncAudioTrack(updatedTrack);
      setTimeout(updateVideoLipsyncTotalDuration, 0);
    }
  };

  const removeVideoLipsyncVideoTrack = () => {
    setVideoLipsyncVideoTrack(null);
    setVideoLipsyncVideoFile(null);
    setVideoLipsyncVideoPreview("");
    setVideoLipsyncVideoDuration(0);
    if (videoLipsyncVideoInputRef.current) videoLipsyncVideoInputRef.current.value = '';
    setTimeout(updateVideoLipsyncTotalDuration, 0);
  };

  const removeVideoLipsyncAudioTrack = () => {
    setVideoLipsyncAudioTrack(null);
    setVideoLipsyncAudioFile(null);
    setVideoLipsyncAudioDuration(0);
    if (videoLipsyncAudioInputRef.current) videoLipsyncAudioInputRef.current.value = '';
    setTimeout(updateVideoLipsyncTotalDuration, 0);
  };

  // Upload video to ComfyUI
  async function uploadVideoToComfy(baseUrl: string, file: File): Promise<string> {
    const form = new FormData();
    form.append("image", file, file.name);

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
  }

  // ===== SUBMIT FUNCTIONS =====

  async function submitOnePerson() {
    setStatus("");
    setVideoUrl("");
    setJobId("");

    if (!comfyUrl) {
      setStatus("Enter ComfyUI URL.");
      return;
    }
    if (!onePersonImageFile) {
      setStatus("Upload an image.");
      return;
    }
    if (!onePersonAudioFile) {
      setStatus("Upload an audio file.");
      return;
    }

    setIsSubmitting(true);
    try {
      setStatus("Checking ComfyUI...");
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      setStatus("Converting image to Base64...");
      const base64Image = await onePersonFileToBase64(onePersonImageFile);

      setStatus("Uploading audio to ComfyUI...");
      const audioUploadResponse = await apiClient.uploadAudioForMultiTalk(onePersonAudioFile, comfyUrl) as {
        success: boolean;
        audio_filename?: string;
        error?: string
      };

      if (!audioUploadResponse.success) {
        throw new Error(audioUploadResponse.error || 'Failed to upload audio');
      }

      const audioFilename = audioUploadResponse.audio_filename;
      if (!audioFilename) {
        throw new Error('No audio filename received from upload');
      }

      setStatus("Sending prompt to ComfyUI...");
      const imageDataUrl = `data:${onePersonImageFile.type};base64,${base64Image}`;

      const response = await apiClient.submitMultiTalkWithTemplate({
        image_data: imageDataUrl,
        audio_filename: audioFilename,
        width: width,
        height: height,
        mode: onePersonWorkflowMode,
        audio_scale: onePersonAudioScale,
        custom_prompt: customPrompt,
        trim_to_audio: true,
        audio_end_time: onePersonWorkflowMode === 'infinitetalk' ? onePersonAudioDuration + 1 : undefined,
        comfy_url: comfyUrl
      }) as { success: boolean; prompt_id?: string; error?: string };

      if (!response.success) {
        throw new Error(response.error || 'Failed to submit to ComfyUI');
      }

      const id = response.prompt_id;
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }
      setJobId(id);

      await apiClient.createVideoJob({
        comfy_job_id: id,
        workflow_name: 'lipsync-one',
        comfy_url: comfyUrl,
        input_image_urls: [onePersonImageFile?.name || ''],
        input_audio_urls: [audioFilename],
        width,
        height,
        fps: 25,
        parameters: {
          mode: onePersonWorkflowMode,
          audio_scale: onePersonAudioScale,
          prompt: customPrompt,
          trim_to_audio: true
        }
      });

      await apiClient.updateVideoJobToProcessing(id);

      setStatus("Processing in ComfyUI...");
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, videoInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing in ComfyUI...');
          } else if (jobStatus === 'completed' && videoInfo) {
            setStatus('Processing completed');
            const fallbackUrl = videoInfo.subfolder
              ? `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=${videoInfo.type || 'output'}`
              : `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=${videoInfo.type || 'output'}`;
            setVideoUrl(fallbackUrl);
            setStatus("Ready!");
            setIsSubmitting(false);

            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'completed',
              output_video_urls: [fallbackUrl]
            });
          } else if (jobStatus === 'error') {
            setStatus(`Error: ${message}`);
            setIsSubmitting(false);
            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'failed',
              error_message: message || 'Unknown error'
            }).catch(() => {});
          }
        }
      );

      setJobMonitorCleanup(() => cleanup);
    } catch (e: any) {
      let errorMessage = e?.message || String(e);
      if (errorMessage.includes('Failed to fetch')) {
        errorMessage = 'Could not connect to ComfyUI. Check the URL.';
      }
      setStatus(`Error: ${errorMessage}`);
      if (jobId) {
        await apiClient.completeVideoJob(jobId, {
          job_id: jobId,
          status: 'failed',
          error_message: errorMessage
        }).catch(() => {});
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitMultiPerson() {
    setStatus('');
    setVideoUrl('');
    setJobId('');

    if (!comfyUrl) return setStatus('Enter ComfyUI URL.');
    if (!multiPersonImageFile) return setStatus('Upload an image.');
    if (!multiPersonAudioTracks.length) return setStatus('Add at least one audio track.');

    const unassigned = multiPersonAudioTracks.filter(t => !t.assignedMaskId);
    if (unassigned.length) return setStatus(`All audio tracks must have a mask assigned. ${unassigned.length} unassigned.`);

    const masksWithAudio = multiPersonMasks.filter(m => multiPersonAudioTracks.some(t => t.assignedMaskId === m.id));
    const masksWithoutData = masksWithAudio.filter(m => !m.maskData);
    if (masksWithoutData.length) {
      return setStatus(`Masks ${masksWithoutData.map(m => m.name).join(', ')} need mask data.`);
    }

    setIsSubmitting(true);
    try {
      setStatus('Checking ComfyUI...');
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      setStatus('Converting image to Base64...');
      const base64 = await fileToBase64(multiPersonImageFile);

      setStatus('Combining audio tracks by mask...');
      const audiosByMask = groupAudiosByMask(multiPersonAudioTracks);
      const maskAudios: Record<string, string> = {};

      for (const [maskId, tracks] of Object.entries(audiosByMask)) {
        if (tracks.length > 0) {
          const joinedAudio = await joinAudiosForMask(tracks, multiPersonTotalDuration);
          const audioFilename = await uploadMediaToComfy(comfyUrl, joinedAudio);
          maskAudios[maskId] = audioFilename;
        }
      }

      setStatus('Building workflow...');
      const prompt = await buildMultiPersonPromptJSON(base64, maskAudios, multiPersonTotalDuration);

      const payload = { prompt, client_id: `multitalk-multiple-${generateId()}` };

      const r = await fetch(`${comfyUrl.replace(/\/$/, '')}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });

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
      const id = resp?.prompt_id || resp?.promptId || '';
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }
      setJobId(id);

      await apiClient.createVideoJob({
        comfy_job_id: id,
        workflow_name: 'lipsync-multi',
        comfy_url: comfyUrl,
        input_image_urls: [multiPersonImageFile.name],
        input_audio_urls: multiPersonAudioTracks.map(track => track.file?.name || ''),
        width,
        height,
        fps: 25,
        parameters: {
          trim_to_audio: true,
          masks: multiPersonMasks.length,
          audio_tracks: multiPersonAudioTracks.length
        }
      });

      await apiClient.updateVideoJobToProcessing(id);

      setStatus('Processing in ComfyUI...');
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, videoInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing in ComfyUI...');
          } else if (jobStatus === 'completed' && videoInfo) {
            setStatus('Processing completed');
            const fallbackUrl = videoInfo.subfolder
              ? `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=${videoInfo.type || 'output'}`
              : `${comfyUrl.replace(/\/$/, '')}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=${videoInfo.type || 'output'}`;
            setVideoUrl(fallbackUrl);
            setStatus('Ready!');
            setIsSubmitting(false);

            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'completed',
              output_video_urls: [fallbackUrl]
            });
          } else if (jobStatus === 'error') {
            setStatus(`Error: ${message}`);
            setIsSubmitting(false);
            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'failed',
              error_message: message || 'Unknown error'
            }).catch(() => {});
          }
        }
      );

      setJobMonitorCleanup(() => cleanup);
    } catch (e: any) {
      let errorMessage = e?.message || String(e);
      if (errorMessage.includes('Failed to fetch')) {
        errorMessage = 'Could not connect to ComfyUI.';
      }
      setStatus(`Error: ${errorMessage}`);
      if (jobId) {
        await apiClient.completeVideoJob(jobId, {
          job_id: jobId,
          status: 'failed',
          error_message: errorMessage
        }).catch(() => {});
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitVideoLipsync() {
    setStatus('');
    setVideoUrl('');
    setJobId('');

    if (!comfyUrl) {
      setStatus('Enter ComfyUI URL.');
      return;
    }
    if (!videoLipsyncVideoFile) {
      setStatus('Upload a video.');
      return;
    }
    if (!videoLipsyncAudioFile) {
      setStatus('Upload an audio file.');
      return;
    }

    setIsSubmitting(true);
    try {
      setStatus('Checking ComfyUI...');
      const healthCheck = await checkComfyUIHealth(comfyUrl);
      if (!healthCheck.available) {
        throw new Error(`${healthCheck.error}${healthCheck.details ? `. ${healthCheck.details}` : ''}`);
      }

      setStatus('Uploading video to ComfyUI...');
      const videoFilename = await uploadVideoToComfy(comfyUrl, videoLipsyncVideoFile);

      setStatus('Uploading audio to ComfyUI...');
      const audioFilename = await uploadMediaToComfy(comfyUrl, videoLipsyncAudioFile);

      setStatus('Sending prompt to ComfyUI...');
      const payload = {
        prompt: await buildVideoLipsyncPromptJSON(videoFilename, audioFilename),
        client_id: `video-lipsync-${generateId()}`,
      };

      const r = await fetch(`${comfyUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000)
      });

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
      const id = resp?.prompt_id || resp?.promptId || "";
      if (!id) {
        throw new Error('ComfyUI did not return a valid prompt ID');
      }
      setJobId(id);

      await apiClient.createVideoJob({
        comfy_job_id: id,
        workflow_name: 'video-lipsync',
        comfy_url: comfyUrl,
        input_video_urls: [videoLipsyncVideoFile.name],
        input_audio_urls: [audioFilename],
        width,
        height,
        fps: 25,
        parameters: {
          audio_scale: videoLipsyncAudioScale,
          trim_to_audio: true,
          has_video: !!videoLipsyncVideoTrack,
          has_audio: !!videoLipsyncAudioTrack
        }
      });

      await apiClient.updateVideoJobToProcessing(id);

      setStatus('Processing in ComfyUI...');
      const cleanup = startJobMonitoring(
        id,
        comfyUrl,
        async (jobStatus, message, videoInfo) => {
          if (jobStatus === 'processing') {
            setStatus(message || 'Processing in ComfyUI...');
          } else if (jobStatus === 'completed' && videoInfo) {
            setStatus('Processing completed');
            const fallbackUrl = videoInfo.subfolder
              ? `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&subfolder=${encodeURIComponent(videoInfo.subfolder)}&type=${videoInfo.type || 'output'}`
              : `${comfyUrl}/view?filename=${encodeURIComponent(videoInfo.filename)}&type=${videoInfo.type || 'output'}`;
            setVideoUrl(fallbackUrl);
            setStatus('Ready!');
            setIsSubmitting(false);

            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'completed',
              output_video_urls: [fallbackUrl]
            });
          } else if (jobStatus === 'error') {
            setStatus(`Error: ${message}`);
            setIsSubmitting(false);
            await apiClient.completeVideoJob(id, {
              job_id: id,
              status: 'failed',
              error_message: message || 'Unknown error'
            }).catch(() => {});
          }
        }
      );

      setJobMonitorCleanup(() => cleanup);
    } catch (e: any) {
      let errorMessage = e?.message || String(e);
      if (errorMessage.includes('Failed to fetch')) {
        errorMessage = 'Could not connect to ComfyUI.';
      }
      setStatus(`Error: ${errorMessage}`);
      if (jobId) {
        await apiClient.completeVideoJob(jobId, {
          job_id: jobId,
          status: 'failed',
          error_message: errorMessage
        }).catch(() => {});
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // Build multi-person workflow JSON
  async function buildMultiPersonPromptJSON(base64Image: string, maskAudios: Record<string, string>, audioDuration: number) {
    const response = await fetch('/workflows/MultiTalkMultiplePeople.json');
    if (!response.ok) {
      throw new Error('Failed to load workflow template');
    }
    const template = await response.json();

    const activeMasks = multiPersonMasks.filter(m => m.maskData && Object.keys(maskAudios).includes(m.id));

    if (activeMasks.length === 0) {
      throw new Error('No masks with both data and audio assigned');
    }

    if (activeMasks.length > 4) {
      throw new Error('Maximum 4 masks supported');
    }

    const adjustedWidth = Math.max(32, Math.round(width / 32) * 32);
    const adjustedHeight = Math.max(32, Math.round(height / 32) * 32);

    const cleanBase64Image = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    const prompt = { ...template };

    if (prompt['214']) {
      prompt['214'].inputs.image = cleanBase64Image;
    }

    if (prompt['223']) {
      prompt['223'].inputs.Number = adjustedWidth.toString();
    }
    if (prompt['224']) {
      prompt['224'].inputs.Number = adjustedHeight.toString();
    }

    activeMasks.forEach((mask, index) => {
      const maskNum = index + 1;
      const base64Data = mask.maskData?.includes(',') ? mask.maskData.split(',')[1] : mask.maskData;

      if (maskNum === 1 && prompt['215']) {
        prompt['215'].inputs.image = base64Data || "";
      } else if (maskNum === 2 && prompt['220']) {
        prompt['220'].inputs.image = base64Data || "";
      }
    });

    if (activeMasks.length >= 3) {
      const cleanBase64Mask3 = activeMasks[2].maskData?.includes(',') ? activeMasks[2].maskData.split(',')[1] : activeMasks[2].maskData;

      prompt['300'] = {
        inputs: { image: cleanBase64Mask3 || "" },
        class_type: "ETN_LoadImageBase64",
        _meta: { title: "Load Image (Base64) - Mask3" }
      };

      prompt['301'] = {
        inputs: {
          width: ["223", 0],
          height: ["224", 0],
          upscale_method: "lanczos",
          keep_proportion: "crop",
          pad_color: "0, 0, 0",
          crop_position: "center",
          divisible_by: 2,
          device: "cpu",
          image: ["300", 0]
        },
        class_type: "ImageResizeKJv2",
        _meta: { title: "Resize Image v2" }
      };

      prompt['302'] = {
        inputs: {
          channel: "red",
          image: ["301", 0]
        },
        class_type: "ImageToMask",
        _meta: { title: "Convert Image to Mask" }
      };

      prompt['243'] = {
        inputs: {
          mask1: ["242", 0],
          mask2: ["302", 0]
        },
        class_type: "MaskBatch+",
        _meta: { title: "Mask Batch 3" }
      };
    }

    if (activeMasks.length >= 4) {
      const cleanBase64Mask4 = activeMasks[3].maskData?.includes(',') ? activeMasks[3].maskData.split(',')[1] : activeMasks[3].maskData;

      prompt['400'] = {
        inputs: { image: cleanBase64Mask4 || "" },
        class_type: "ETN_LoadImageBase64",
        _meta: { title: "Load Image (Base64) - Mask4" }
      };

      prompt['401'] = {
        inputs: {
          width: ["223", 0],
          height: ["224", 0],
          upscale_method: "lanczos",
          keep_proportion: "crop",
          pad_color: "0, 0, 0",
          crop_position: "center",
          divisible_by: 2,
          device: "cpu",
          image: ["400", 0]
        },
        class_type: "ImageResizeKJv2",
        _meta: { title: "Resize Image v2" }
      };

      prompt['402'] = {
        inputs: {
          channel: "red",
          image: ["401", 0]
        },
        class_type: "ImageToMask",
        _meta: { title: "Convert Image to Mask" }
      };

      prompt['244'] = {
        inputs: {
          mask1: ["243", 0],
          mask2: ["402", 0]
        },
        class_type: "MaskBatch+",
        _meta: { title: "Mask Batch 4" }
      };
    }

    activeMasks.forEach((_, index) => {
      const audioNum = index + 1;
      const mask = activeMasks[index];
      const audioFilename = maskAudios[mask.id];
      if (audioFilename) {
        prompt[`125_${audioNum}`] = {
          inputs: { audio: audioFilename, audioUI: "" },
          class_type: "LoadAudio",
          _meta: { title: `LoadAudio ${audioNum}` }
        };

        prompt[`196_${audioNum}`] = {
          inputs: {
            start_time: "0:00",
            end_time: audioDuration.toString(),
            audio: [`125_${audioNum}`, 0]
          },
          class_type: "AudioCrop",
          _meta: { title: `AudioCrop ${audioNum}` }
        };

        prompt[`197_${audioNum}`] = {
          inputs: {
            chunk_fade_shape: "linear",
            chunk_length: 10,
            chunk_overlap: 0.1,
            audio: [`196_${audioNum}`, 0]
          },
          class_type: "AudioSeparation",
          _meta: { title: `AudioSeparation ${audioNum}` }
        };
      }
    });

    let maskBatchRef: [string, number];
    switch (activeMasks.length) {
      case 1:
        maskBatchRef = ["218", 0];
        break;
      case 2:
        maskBatchRef = ["242", 0];
        break;
      case 3:
        maskBatchRef = ["243", 0];
        break;
      case 4:
        maskBatchRef = ["244", 0];
        break;
      default:
        throw new Error('Unexpected number of masks');
    }

    const audioInputs: Record<string, any> = {};
    activeMasks.forEach((_, index) => {
      const audioNum = index + 1;
      audioInputs[`audio_${audioNum}`] = [`197_${audioNum}`, 3];
    });

    for (let i = activeMasks.length + 1; i <= 4; i++) {
      audioInputs[`audio_${i}`] = null;
    }

    if (prompt["123"]) {
      const fps = 25;
      const numFrames = fps * (audioDuration + 1);

      prompt["123"].inputs = {
        normalize_loudness: true,
        num_frames: numFrames,
        fps: fps,
        audio_scale: 1,
        audio_cfg_scale: 2,
        multi_audio_type: "para",
        wav2vec_model: ["137", 0],
        ref_target_masks: maskBatchRef,
        ...audioInputs
      };
    }

    if (prompt["135"] && prompt["135"].inputs) {
      prompt["135"].inputs.positive_prompt = customPrompt;
    }

    return prompt;
  }

  // Build video lipsync workflow JSON
  async function buildVideoLipsyncPromptJSON(videoFilename: string, audioFilename: string) {
    const response = await fetch('/workflows/VideoLipsync.json');
    if (!response.ok) {
      throw new Error('Failed to load workflow template');
    }
    const template = await response.json();

    const audioStartTime = videoLipsyncAudioTrack ? `${Math.floor(videoLipsyncAudioTrack.startTime / 60)}:${String(Math.floor(videoLipsyncAudioTrack.startTime % 60)).padStart(2, '0')}` : "0:00";
    const audioEndTime = videoLipsyncAudioTrack ? `${Math.floor((videoLipsyncAudioTrack.startTime + videoLipsyncAudioTrack.duration) / 60)}:${String(Math.ceil((videoLipsyncAudioTrack.startTime + videoLipsyncAudioTrack.duration) % 60)).padStart(2, '0')}` : "2:00";
    const videoStartFrame = videoLipsyncVideoTrack ? Math.floor(videoLipsyncVideoTrack.startTime * 25) : 0;

    const fps = 25;
    const videoStartTime = videoLipsyncVideoTrack ? videoLipsyncVideoTrack.startTime : 0;
    const audioStartTime_seconds = videoLipsyncAudioTrack ? videoLipsyncAudioTrack.startTime : 0;
    const videoEndTime = videoLipsyncVideoTrack ? videoLipsyncVideoTrack.startTime + videoLipsyncVideoTrack.duration : 0;
    const audioEndTime_seconds = videoLipsyncAudioTrack ? videoLipsyncAudioTrack.startTime + videoLipsyncAudioTrack.duration : 0;

    const blackFramesStart = videoLipsyncVideoTrack && videoLipsyncAudioTrack && audioStartTime_seconds < videoStartTime
      ? Math.floor((videoStartTime - audioStartTime_seconds) * fps)
      : 0;

    const blackFramesEnd = videoLipsyncVideoTrack && videoLipsyncAudioTrack && audioEndTime_seconds > videoEndTime
      ? Math.floor((audioEndTime_seconds - videoEndTime) * fps)
      : 0;

    let concatInputCount = 2;
    let concatInput1Node = "301";
    let concatInput1Index = "0";
    let concatInput2Node = "301";
    let concatInput2Index = "0";
    let concatInput3Node = "301";
    let concatInput3Index = "0";

    if (blackFramesStart > 0 && blackFramesEnd > 0) {
      concatInputCount = 3;
      concatInput1Node = "311";
      concatInput1Index = "0";
      concatInput2Node = "301";
      concatInput2Index = "0";
      concatInput3Node = "313";
      concatInput3Index = "0";
    } else if (blackFramesStart > 0) {
      concatInputCount = 2;
      concatInput1Node = "311";
      concatInput1Index = "0";
      concatInput2Node = "301";
      concatInput2Index = "0";
    } else if (blackFramesEnd > 0) {
      concatInputCount = 2;
      concatInput1Node = "301";
      concatInput1Index = "0";
      concatInput2Node = "313";
      concatInput2Index = "0";
    }

    const promptString = JSON.stringify(template)
      .replace(/"\{\{VIDEO_FILENAME\}\}"/g, `"${videoFilename}"`)
      .replace(/"\{\{AUDIO_FILENAME\}\}"/g, `"${audioFilename}"`)
      .replace(/"\{\{WIDTH\}\}"/g, width.toString())
      .replace(/"\{\{HEIGHT\}\}"/g, height.toString())
      .replace(/"\{\{AUDIO_SCALE\}\}"/g, videoLipsyncAudioScale.toString())
      .replace(/"\{\{AUDIO_START_TIME\}\}"/g, `"${audioStartTime}"`)
      .replace(/"\{\{AUDIO_END_TIME\}\}"/g, `"${audioEndTime}"`)
      .replace(/"\{\{VIDEO_START_FRAME\}\}"/g, videoStartFrame.toString())
      .replace(/"\{\{CUSTOM_PROMPT\}\}"/g, `"${customPrompt.replace(/"/g, '\\"')}"`)
      .replace(/"\{\{TRIM_TO_AUDIO\}\}"/g, "true")
      .replace(/"\{\{BLACK_FRAME_COUNT_START\}\}"/g, blackFramesStart.toString())
      .replace(/"\{\{BLACK_FRAME_COUNT_END\}\}"/g, blackFramesEnd.toString())
      .replace(/"\{\{CONCAT_INPUT_COUNT\}\}"/g, concatInputCount.toString())
      .replace(/"\{\{CONCAT_INPUT_1_NODE\}\}"/g, `"${concatInput1Node}"`)
      .replace(/"\{\{CONCAT_INPUT_1_INDEX\}\}"/g, concatInput1Index)
      .replace(/"\{\{CONCAT_INPUT_2_NODE\}\}"/g, `"${concatInput2Node}"`)
      .replace(/"\{\{CONCAT_INPUT_2_INDEX\}\}"/g, concatInput2Index)
      .replace(/"\{\{CONCAT_INPUT_3_NODE\}\}"/g, `"${concatInput3Node}"`)
      .replace(/"\{\{CONCAT_INPUT_3_INDEX\}\}"/g, concatInput3Index);

    return JSON.parse(promptString);
  }

  function handleDownload() {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `lipsync-${activeMode}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Get current workflow name for VideoFeed
  const getWorkflowName = () => {
    switch (activeMode) {
      case 'one-person': return 'lipsync-one';
      case 'multi-person': return 'lipsync-multi';
      case 'video-lipsync': return 'video-lipsync';
    }
  };

  // Submit based on active mode
  const handleSubmit = () => {
    switch (activeMode) {
      case 'one-person': return submitOnePerson();
      case 'multi-person': return submitMultiPerson();
      case 'video-lipsync': return submitVideoLipsync();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="flex gap-6 p-6 md:p-10">
        {/* Main Content */}
        <div className="flex-1 max-w-4xl space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 py-8">
            <h1 className="text-4xl md:text-6xl font-black bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              Lipsync Studio
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Generate realistic talking videos from images or sync audio to existing videos
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-2 shadow-lg border border-gray-200/50">
            <div className="flex gap-2">
              <TabButton
                mode="one-person"
                currentMode={activeMode}
                onClick={() => setActiveMode('one-person')}
                icon="👤"
                label="1 Person"
                gradient="from-blue-500 to-purple-600"
              />
              <TabButton
                mode="multi-person"
                currentMode={activeMode}
                onClick={() => setActiveMode('multi-person')}
                icon="👥"
                label="Multi Person"
                gradient="from-emerald-500 to-teal-600"
              />
              <TabButton
                mode="video-lipsync"
                currentMode={activeMode}
                onClick={() => setActiveMode('video-lipsync')}
                icon="🎬"
                label="Video Lipsync"
                gradient="from-green-500 to-blue-600"
              />
            </div>
          </div>

          {/* Shared Prompt Section */}
          <Section title="Prompt">
            <Field>
              <Label>Custom Prompt</Label>
              <textarea
                rows={3}
                className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all duration-200 bg-white/80 resize-vertical"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Describe what the person should be doing..."
              />
              <p className="text-xs text-gray-500 mt-1">Description of what you want the person to do in the video</p>
            </Field>
          </Section>

          {/* ONE-PERSON MODE CONTENT */}
          {activeMode === 'one-person' && (
            <>
              <Section title="Mode">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="one-person-mode"
                      value="multitalk"
                      checked={onePersonWorkflowMode === 'multitalk'}
                      onChange={(e) => setOnePersonWorkflowMode(e.target.value as 'multitalk' | 'infinitetalk')}
                      className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">MultiTalk</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="one-person-mode"
                      value="infinitetalk"
                      checked={onePersonWorkflowMode === 'infinitetalk'}
                      onChange={(e) => setOnePersonWorkflowMode(e.target.value as 'multitalk' | 'infinitetalk')}
                      className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                    />
                    <span className="text-sm font-medium text-gray-700">InfiniteTalk</span>
                  </label>
                </div>
                {onePersonWorkflowMode === 'infinitetalk' && (
                  <div className="mt-4">
                    <Field>
                      <Label>Audio Scale</Label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="2.0"
                        className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                        value={onePersonAudioScale}
                        onChange={(e) => setOnePersonAudioScale(Number(e.target.value))}
                      />
                      <p className="text-xs text-gray-500 mt-1">Audio scale for InfiniteTalk (0.1 - 2.0)</p>
                    </Field>
                  </div>
                )}
              </Section>

              <Section title="Input">
                <div className="grid md:grid-cols-2 gap-6">
                  <Field>
                    <Label>Image</Label>
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setOnePersonImageFile(e.target.files?.[0] || null)}
                        className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50"
                      />
                    </div>
                    {onePersonImagePreview && (
                      <div className="mt-3">
                        <img ref={onePersonImgRef} src={onePersonImagePreview} alt="preview" className="w-full rounded-2xl shadow-lg border border-gray-200" />
                      </div>
                    )}
                  </Field>
                  <Field>
                    <Label>Audio</Label>
                    <div className="relative">
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          setOnePersonAudioFile(file);
                          if (file) {
                            const audio = new Audio();
                            const url = URL.createObjectURL(file);
                            audio.addEventListener('loadedmetadata', () => {
                              setOnePersonAudioDuration(audio.duration);
                              URL.revokeObjectURL(url);
                            });
                            audio.src = url;
                          } else {
                            setOnePersonAudioDuration(0);
                          }
                        }}
                        className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-green-500 file:to-teal-600 file:text-white file:font-semibold hover:file:from-green-600 hover:file:to-teal-700 transition-all duration-200 bg-gray-50/50"
                      />
                    </div>
                    {onePersonAudioDuration > 0 && (
                      <p className="text-xs text-green-600 mt-1">Duration: {onePersonAudioDuration.toFixed(1)}s</p>
                    )}
                  </Field>
                </div>
              </Section>
            </>
          )}

          {/* MULTI-PERSON MODE CONTENT */}
          {activeMode === 'multi-person' && (
            <>
              <Section title="Input">
                <div className="grid md:grid-cols-2 gap-6">
                  <Field>
                    <Label>Image</Label>
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setMultiPersonImageFile(e.target.files?.[0] || null)}
                        className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50"
                      />
                    </div>
                    {multiPersonImagePreview && (
                      <div className="mt-3">
                        <img src={multiPersonImagePreview} alt="preview" className="w-full rounded-2xl shadow-lg border border-gray-200" />
                      </div>
                    )}
                  </Field>
                  <Field>
                    <Label>Resolution</Label>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Width (px)</Label>
                        <input
                          type="number"
                          className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                          value={widthInput}
                          onChange={(e) => handleWidthChange(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label>Height (px)</Label>
                        <input
                          type="number"
                          className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                          value={heightInput}
                          onChange={(e) => handleHeightChange(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-3">Auto-corrects to multiples of 32</p>
                  </Field>
                </div>
              </Section>

              <Section title="Masks per Person">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    Create one mask per person to guide the lipsync.
                  </p>
                  <Button
                    variant="accent"
                    size="md"
                    onClick={createMask}
                    disabled={!multiPersonImagePreview}
                    className={!multiPersonImagePreview ? 'opacity-50 cursor-not-allowed' : ''}
                  >
                    New Mask
                  </Button>
                </div>

                {!multiPersonMasks.length ? (
                  <div className="mt-3 rounded bg-gray-100 p-4 text-sm text-gray-600">
                    No masks yet.
                  </div>
                ) : (
                  <ul className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {multiPersonMasks.map((m) => (
                      <li key={m.id} className="rounded-lg bg-gradient-to-br from-white to-blue-50 border border-blue-200 p-3 shadow-sm hover:shadow-md transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded border border-gray-300 bg-gray-100 overflow-hidden flex-shrink-0">
                              {m.maskData ? (
                                <img
                                  src={m.maskData}
                                  alt={`${m.name} preview`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                  Empty
                                </div>
                              )}
                            </div>
                            <input
                              value={m.name}
                              onChange={(e) =>
                                setMultiPersonMasks((prev) =>
                                  prev.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x))
                                )
                              }
                              className="font-medium outline-none rounded px-1 py-0.5 hover:bg-gray-50"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setMultiPersonIsEditingMask(m.id);
                                setMultiPersonShowMaskModal(true);
                              }}
                              disabled={!multiPersonImagePreview}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => deleteMask(m.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 flex gap-2">
                          {m.maskData ? (
                            <Badge variant="success">Has Data</Badge>
                          ) : (
                            <Badge variant="warning">Empty</Badge>
                          )}
                          <Badge variant="primary">
                            {multiPersonAudioTracks.filter(t => t.assignedMaskId === m.id).length} audio(s)
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Audio & Timeline">
                <div
                  onDrop={(e) => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files || []).filter((f) =>
                      /^audio\//.test(f.type) || /\.(wav|mp3|m4a|flac|ogg)$/i.test(f.name)
                    );
                    if (files.length) {
                      onMultiPersonAudioSelect({ files } as any);
                    }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnter={(e) => e.preventDefault()}
                  className="mb-4 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-600"
                >
                  Drag audio files here, or
                  <button
                    type="button"
                    onClick={addAudioClick}
                    className="ml-2 rounded-md bg-gray-100 px-2 py-1 text-sm hover:bg-gray-200"
                  >
                    browse
                  </button>
                  <input
                    ref={multiPersonFileInputRef}
                    type="file"
                    accept="audio/*"
                    multiple
                    className="hidden"
                    onChange={onMultiPersonAudioSelect}
                  />
                </div>

                <Timeline
                  tracks={multiPersonAudioTracks}
                  totalDuration={multiPersonTotalDuration}
                  onUpdateTrackTime={updateMultiPersonTrackStart}
                  onRemoveTrack={removeMultiPersonTrack}
                  onUpdateTotalDuration={setMultiPersonTotalDuration}
                />

                {!!multiPersonAudioTracks.length && (
                  <div className="mt-4 space-y-2">
                    {multiPersonAudioTracks.map((t, i) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded bg-gray-50 p-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-white text-[10px]">
                            {i + 1}
                          </span>
                          <span className="font-medium truncate max-w-[220px]" title={t.name}>
                            {t.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Mask</Label>
                          <select
                            value={t.assignedMaskId ?? ''}
                            onChange={(e) => assignMask(t.id, e.target.value || null)}
                            className="rounded px-2 py-1 bg-gray-100"
                          >
                            <option value="">Select...</option>
                            {multiPersonMasks.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}

          {/* VIDEO-LIPSYNC MODE CONTENT */}
          {activeMode === 'video-lipsync' && (
            <>
              <Section title="Settings">
                <div className="grid md:grid-cols-2 gap-4">
                  <Field>
                    <Label>Audio Scale</Label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="3.0"
                      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all duration-200 bg-white/80"
                      value={videoLipsyncAudioScale}
                      onChange={(e) => setVideoLipsyncAudioScale(Number(e.target.value))}
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
                    </div>
                    <div>
                      <Label>Height (px)</Label>
                      <input
                        type="number"
                        className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-green-500 focus:ring-4 focus:ring-green-100 transition-all duration-200 bg-white/80"
                        value={heightInput}
                        onChange={(e) => handleHeightChange(e.target.value)}
                      />
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
                        ref={videoLipsyncVideoInputRef}
                        type="file"
                        accept="video/*"
                        onChange={onVideoLipsyncVideoSelect}
                        className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-green-500 file:to-blue-600 file:text-white file:font-semibold hover:file:from-green-600 hover:file:to-blue-700 transition-all duration-200 bg-gray-50/50"
                      />
                    </div>
                    {videoLipsyncVideoPreview && (
                      <div className="mt-3">
                        <video src={videoLipsyncVideoPreview} controls className="w-full rounded-2xl shadow-lg border border-gray-200" />
                      </div>
                    )}
                    {videoLipsyncVideoDuration > 0 && (
                      <p className="text-xs text-green-600 mt-1">Duration: {videoLipsyncVideoDuration.toFixed(1)}s</p>
                    )}
                  </Field>

                  <Field>
                    <Label>Audio Source</Label>
                    <div className="relative">
                      <input
                        ref={videoLipsyncAudioInputRef}
                        type="file"
                        accept="audio/*"
                        onChange={onVideoLipsyncAudioSelect}
                        className="w-full rounded-2xl border-2 border-dashed border-gray-300 px-4 py-6 text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-blue-500 file:to-purple-600 file:text-white file:font-semibold hover:file:from-blue-600 hover:file:to-purple-700 transition-all duration-200 bg-gray-50/50"
                      />
                    </div>
                    {videoLipsyncAudioDuration > 0 && (
                      <p className="text-xs text-blue-600 mt-1">Duration: {videoLipsyncAudioDuration.toFixed(1)}s</p>
                    )}
                  </Field>
                </div>
              </Section>

              <Section title="Timeline Sync">
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Drag the tracks on the timeline to adjust when your video and audio start playing.
                  </p>
                  <Timeline
                    tracks={[
                      ...(videoLipsyncVideoTrack ? [{ ...videoLipsyncVideoTrack, assignedMaskId: null }] : []),
                      ...(videoLipsyncAudioTrack ? [{ ...videoLipsyncAudioTrack, assignedMaskId: null }] : [])
                    ]}
                    totalDuration={videoLipsyncTotalDuration}
                    onUpdateTrackTime={(id, startTime) => {
                      if (videoLipsyncVideoTrack && videoLipsyncVideoTrack.id === id) {
                        updateVideoLipsyncVideoTrackTime(id, startTime);
                      } else if (videoLipsyncAudioTrack && videoLipsyncAudioTrack.id === id) {
                        updateVideoLipsyncAudioTrackTime(id, startTime);
                      }
                    }}
                    onRemoveTrack={(id) => {
                      if (videoLipsyncVideoTrack && videoLipsyncVideoTrack.id === id) {
                        removeVideoLipsyncVideoTrack();
                      } else if (videoLipsyncAudioTrack && videoLipsyncAudioTrack.id === id) {
                        removeVideoLipsyncAudioTrack();
                      }
                    }}
                    onUpdateTotalDuration={updateVideoLipsyncTotalDuration}
                  />

                  {videoLipsyncVideoTrack && videoLipsyncAudioTrack && (
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                      <div className="font-medium text-gray-800 mb-2">Quick Timing Presets</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            updateVideoLipsyncVideoTrackTime(videoLipsyncVideoTrack.id, 0);
                            updateVideoLipsyncAudioTrackTime(videoLipsyncAudioTrack.id, 0);
                          }}
                          className="px-3 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
                        >
                          Both at Start
                        </button>
                        <button
                          onClick={() => {
                            updateVideoLipsyncAudioTrackTime(videoLipsyncAudioTrack.id, 0);
                            updateVideoLipsyncVideoTrackTime(videoLipsyncVideoTrack.id, 2);
                          }}
                          className="px-3 py-1 text-xs bg-blue-200 hover:bg-blue-300 rounded-lg transition-colors"
                        >
                          Audio First (+2s video)
                        </button>
                        <button
                          onClick={() => {
                            updateVideoLipsyncVideoTrackTime(videoLipsyncVideoTrack.id, 0);
                            updateVideoLipsyncAudioTrackTime(videoLipsyncAudioTrack.id, 1);
                          }}
                          className="px-3 py-1 text-xs bg-green-200 hover:bg-green-300 rounded-lg transition-colors"
                        >
                          Video First (+1s audio)
                        </button>
                        <button
                          onClick={() => {
                            updateVideoLipsyncVideoTrackTime(videoLipsyncVideoTrack.id, videoLipsyncOriginalVideoStart);
                            updateVideoLipsyncAudioTrackTime(videoLipsyncAudioTrack.id, videoLipsyncOriginalAudioStart);
                          }}
                          className="px-3 py-1 text-xs bg-gray-300 hover:bg-gray-400 rounded-lg transition-colors"
                        >
                          Reset Original
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </Section>

              {/* Timeline Preview */}
              {videoLipsyncVideoFile && videoLipsyncAudioFile && videoLipsyncVideoPreview && videoLipsyncAudioPreviewUrl && (
                <Section title="Timeline Preview">
                  <div className="space-y-6">
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                      <div className="font-medium text-blue-800 mb-1">Live Preview</div>
                      <p className="text-blue-600 text-sm">
                        This preview shows exactly how your final video will look with automatic black frame padding.
                      </p>
                    </div>

                    <AVPlayerWithPadding
                      videoSrc={videoLipsyncVideoPreview}
                      audioSrc={videoLipsyncAudioPreviewUrl}
                      videoStart={videoLipsyncVideoTrack?.startTime || 0}
                      videoDuration={videoLipsyncVideoTrack?.duration}
                      audioStart={videoLipsyncAudioTrack?.startTime || 0}
                      audioDuration={videoLipsyncAudioTrack?.duration}
                      viewportSize={{ width: width, height: height }}
                      className="max-w-2xl mx-auto"
                    />
                  </div>
                </Section>
              )}
            </>
          )}

          {/* Shared Resolution Section (for one-person mode) */}
          {activeMode === 'one-person' && (
            <Section title="Output Resolution">
              <div className="grid md:grid-cols-2 gap-4 items-end">
                <Field>
                  <Label>Width (px)</Label>
                  <input
                    type="number"
                    className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                    value={widthInput}
                    onChange={(e) => handleWidthChange(e.target.value)}
                  />
                </Field>
                <Field>
                  <Label>Height (px)</Label>
                  <input
                    type="number"
                    className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-800 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 transition-all duration-200 bg-white/80"
                    value={heightInput}
                    onChange={(e) => handleHeightChange(e.target.value)}
                  />
                </Field>
              </div>
              <p className="text-xs text-gray-500 mt-3">Auto-corrects to multiples of 32</p>
            </Section>
          )}

          {/* Generate Section */}
          <Section title="Generate">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold text-lg shadow-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    Generate
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
                  <button
                    className="px-6 py-3 rounded-2xl border-2 border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-semibold shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2"
                    onClick={handleDownload}
                  >
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
            <GenerationFeed
              config={{
                mediaType: 'video',
                workflowNames: [getWorkflowName()],
                pageContext: getWorkflowName(),
                showCompletedOnly: false,
                maxItems: 10,
                showFixButton: true,
                showProgress: true,
                comfyUrl: comfyUrl
              }}
            />
          </div>
        </div>
      </div>

      {/* Multi-Person Mask Editing Modal */}
      {multiPersonShowMaskModal && multiPersonIsEditingMask && multiPersonImagePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setMultiPersonShowMaskModal(false);
              setMultiPersonIsEditingMask(null);
            }}
          />

          <div className="relative bg-white dark:bg-gray-800 rounded-3xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  Mask Editor
                </h2>
                <input
                  type="text"
                  value={multiPersonMasks.find(m => m.id === multiPersonIsEditingMask)?.name || ''}
                  onChange={(e) => {
                    const newName = e.target.value;
                    setMultiPersonMasks(v => v.map(m => m.id === multiPersonIsEditingMask ? { ...m, name: newName } : m));
                  }}
                  className="px-3 py-1 rounded-lg border border-gray-300 focus:border-purple-500 focus:outline-none"
                  placeholder="Mask name"
                />
              </div>
              <button
                onClick={() => {
                  setMultiPersonShowMaskModal(false);
                  setMultiPersonIsEditingMask(null);
                }}
                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
              <MaskEditor
                imageUrl={multiPersonImagePreview}
                maskName={multiPersonMasks.find(m => m.id === multiPersonIsEditingMask)?.name || ''}
                existingMask={multiPersonMasks.find(m => m.id === multiPersonIsEditingMask)?.maskData || null}
                onMaskUpdate={(maskData) => {
                  if (multiPersonIsEditingMask) {
                    updateMask(multiPersonIsEditingMask, maskData);
                  }
                }}
              />

              <div className="flex justify-end gap-3 pt-6 border-t border-gray-200 mt-6">
                <button
                  onClick={() => {
                    setMultiPersonShowMaskModal(false);
                    setMultiPersonIsEditingMask(null);
                  }}
                  className="px-6 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
