import { useRef, useEffect, useState, useCallback } from 'react';

interface AVPlayerWithPaddingProps {
  videoSrc: string;
  audioSrc: string;
  videoStart: number; // seconds, timeline position where video should appear
  videoDuration?: number; // seconds, will be auto-detected if not provided
  audioStart: number; // seconds, timeline position where audio should start
  audioDuration?: number; // seconds, will be auto-detected if not provided
  viewportSize: { width: number; height: number };
  className?: string;
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (totalDuration: number) => void;
}

export function AVPlayerWithPadding({
  videoSrc,
  audioSrc,
  videoStart,
  videoDuration,
  audioStart,
  audioDuration,
  viewportSize,
  className = '',
  onTimeUpdate,
  onDurationChange
}: AVPlayerWithPaddingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  
  // Internal timing
  const masterClockRef = useRef<number>(0);
  const seekOffsetRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);
  
  // Media metadata
  const [videoMetadata, setVideoMetadata] = useState<{ duration: number; width: number; height: number } | null>(null);
  const [audioMetadata, setAudioMetadata] = useState<{ duration: number } | null>(null);
  
  // Calculate timeline bounds
  const getTimelineBounds = useCallback(() => {
    const vDuration = videoDuration || videoMetadata?.duration || 0;
    const aDuration = audioDuration || audioMetadata?.duration || 0;
    
    const timelineStart = Math.min(videoStart, audioStart);
    const timelineEnd = Math.max(videoStart + vDuration, audioStart + aDuration);
    
    return { timelineStart, timelineEnd, videoDuration: vDuration, audioDuration: aDuration };
  }, [videoStart, audioStart, videoDuration, audioDuration, videoMetadata, audioMetadata]);
  
  // Check if time is in active ranges
  const isVideoActive = useCallback((t: number, vDuration: number) => {
    return t >= videoStart && t < videoStart + vDuration;
  }, [videoStart]);
  
  const isAudioActive = useCallback((t: number, aDuration: number) => {
    return t >= audioStart && t < audioStart + aDuration;
  }, [audioStart]);
  
  // Draw frame on canvas
  const drawFrame = useCallback((t: number) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const { videoDuration: vDuration } = getTimelineBounds();
    
    // Always fill with black first
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // If video is active, draw the video frame
    if (isVideoActive(t, vDuration) && video.readyState >= 2) {
      // Calculate aspect ratio and letterboxing
      const videoAspect = videoMetadata ? videoMetadata.width / videoMetadata.height : 16/9;
      const canvasAspect = canvas.width / canvas.height;
      
      let drawWidth = canvas.width;
      let drawHeight = canvas.height;
      let drawX = 0;
      let drawY = 0;
      
      if (videoAspect > canvasAspect) {
        // Video is wider - letterbox top/bottom
        drawHeight = canvas.width / videoAspect;
        drawY = (canvas.height - drawHeight) / 2;
      } else {
        // Video is taller - letterbox left/right
        drawWidth = canvas.height * videoAspect;
        drawX = (canvas.width - drawWidth) / 2;
      }
      
      ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
    }
  }, [getTimelineBounds, isVideoActive, videoMetadata]);
  
  // Update media elements to match timeline time
  const syncMediaToTime = useCallback((t: number) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    const { videoDuration: vDuration, audioDuration: aDuration } = getTimelineBounds();
    
    // Sync video
    if (video && isVideoActive(t, vDuration)) {
      const videoTime = t - videoStart;
      const clampedVideoTime = Math.max(0, Math.min(videoTime, vDuration));
      
      // Only seek if there's significant drift (> 40ms)
      if (Math.abs(video.currentTime - clampedVideoTime) > 0.04) {
        video.currentTime = clampedVideoTime;
      }
      
      if (video.paused && isPlaying) {
        video.play().catch(console.error);
      }
    } else if (video && !video.paused) {
      video.pause();
    }
    
    // Sync audio
    if (audio && isAudioActive(t, aDuration)) {
      const audioTime = t - audioStart;
      const clampedAudioTime = Math.max(0, Math.min(audioTime, aDuration));
      
      // Only seek if there's significant drift (> 40ms)
      if (Math.abs(audio.currentTime - clampedAudioTime) > 0.04) {
        audio.currentTime = clampedAudioTime;
      }
      
      audio.muted = false;
      if (audio.paused && isPlaying) {
        audio.play().catch(console.error);
      }
    } else if (audio) {
      audio.muted = true;
      if (!audio.paused) {
        audio.pause();
      }
    }
  }, [getTimelineBounds, isVideoActive, isAudioActive, videoStart, audioStart, isPlaying]);
  
  // Animation loop
  const tick = useCallback(() => {
    if (!isPlaying) return;
    
    const now = performance.now();
    const t = (now - masterClockRef.current) / 1000 + seekOffsetRef.current;
    const { timelineStart, timelineEnd } = getTimelineBounds();
    
    const clampedTime = Math.max(timelineStart, Math.min(t, timelineEnd));
    
    setCurrentTime(clampedTime);
    onTimeUpdate?.(clampedTime);
    
    syncMediaToTime(clampedTime);
    drawFrame(clampedTime);
    
    // Stop if we've reached the end
    if (t >= timelineEnd) {
      setIsPlaying(false);
      return;
    }
    
    animationFrameRef.current = requestAnimationFrame(tick);
  }, [isPlaying, getTimelineBounds, syncMediaToTime, drawFrame, onTimeUpdate]);
  
  // Start playback loop
  useEffect(() => {
    if (isPlaying) {
      masterClockRef.current = performance.now();
      tick();
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, tick]);
  
  // Handle media loaded metadata
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    
    const handleVideoMetadata = () => {
      if (video) {
        setVideoMetadata({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight
        });
      }
    };
    
    const handleAudioMetadata = () => {
      if (audio) {
        setAudioMetadata({ duration: audio.duration });
      }
    };
    
    if (video) {
      video.addEventListener('loadedmetadata', handleVideoMetadata);
      if (video.readyState >= 1) handleVideoMetadata();
    }
    
    if (audio) {
      audio.addEventListener('loadedmetadata', handleAudioMetadata);
      if (audio.readyState >= 1) handleAudioMetadata();
    }
    
    return () => {
      video?.removeEventListener('loadedmetadata', handleVideoMetadata);
      audio?.removeEventListener('loadedmetadata', handleAudioMetadata);
    };
  }, [videoSrc, audioSrc]);
  
  // Update ready state and total duration
  useEffect(() => {
    const hasVideoMeta = !videoDuration || videoMetadata !== null;
    const hasAudioMeta = !audioDuration || audioMetadata !== null;
    
    if (hasVideoMeta && hasAudioMeta) {
      setIsReady(true);
      const { timelineEnd } = getTimelineBounds();
      setTotalDuration(timelineEnd);
      onDurationChange?.(timelineEnd);
    }
  }, [videoMetadata, audioMetadata, videoDuration, audioDuration, getTimelineBounds, onDurationChange]);
  
  // Handle timeline position changes
  useEffect(() => {
    if (isReady) {
      const { timelineEnd } = getTimelineBounds();
      setTotalDuration(timelineEnd);
      onDurationChange?.(timelineEnd);
      
      // If currently playing, sync media immediately
      if (!isPlaying) {
        // If paused, update the current frame to show new positions
        drawFrame(currentTime);
        syncMediaToTime(currentTime);
      }
    }
  }, [videoStart, audioStart, isReady, getTimelineBounds, onDurationChange, drawFrame, syncMediaToTime, currentTime, isPlaying]);
  
  // Set canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = viewportSize.width;
      canvas.height = viewportSize.height;
      // Redraw current frame
      drawFrame(currentTime);
    }
  }, [viewportSize, drawFrame, currentTime]);
  
  // Play/pause control
  const togglePlayPause = useCallback(() => {
    if (!isReady) return;
    setIsPlaying(prev => !prev);
  }, [isReady]);
  
  // Seek control
  const seekTo = useCallback((newTime: number) => {
    const { timelineStart, timelineEnd } = getTimelineBounds();
    const clampedTime = Math.max(timelineStart, Math.min(newTime, timelineEnd));
    
    seekOffsetRef.current = clampedTime;
    masterClockRef.current = performance.now();
    setCurrentTime(clampedTime);
    onTimeUpdate?.(clampedTime);
    
    // Immediately sync media and draw
    syncMediaToTime(clampedTime);
    drawFrame(clampedTime);
  }, [getTimelineBounds, syncMediaToTime, drawFrame, onTimeUpdate]);
  
  // Format time for display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  return (
    <div className={`av-player-with-padding ${className}`}>
      {/* Hidden media elements */}
      <video
        ref={videoRef}
        src={videoSrc}
        preload="metadata"
        style={{ display: 'none' }}
        muted // Video audio handled by separate audio element
      />
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        style={{ display: 'none' }}
      />
      
      {/* Canvas for video display */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full h-auto bg-black rounded-lg"
          style={{ aspectRatio: `${viewportSize.width}/${viewportSize.height}` }}
        />
        
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 rounded-lg">
            <div className="text-white text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
              <p>Loading media...</p>
            </div>
          </div>
        )}
      </div>
      
      {/* Controls */}
      {isReady && (
        <div className="mt-4 space-y-3">
          {/* Playback controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlayPause}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {isPlaying ? '⏸️ Pause' : '▶️ Play'}
            </button>
            
            <span className="text-sm text-gray-600">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
          </div>
          
          {/* Seek bar */}
          <div className="relative">
            <input
              type="range"
              min={0}
              max={totalDuration}
              step={0.1}
              value={currentTime}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              className="w-full"
            />
            
            {/* Timeline visualization */}
            <div className="mt-1 h-2 bg-gray-200 rounded relative">
              {/* Video active range */}
              <div
                className="absolute h-full bg-green-400 rounded"
                style={{
                  left: `${(videoStart / totalDuration) * 100}%`,
                  width: `${((videoDuration || videoMetadata?.duration || 0) / totalDuration) * 100}%`
                }}
              />
              {/* Audio active range */}
              <div
                className="absolute h-full bg-blue-400 rounded opacity-60"
                style={{
                  left: `${(audioStart / totalDuration) * 100}%`,
                  width: `${((audioDuration || audioMetadata?.duration || 0) / totalDuration) * 100}%`
                }}
              />
              {/* Current time indicator */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                style={{ left: `${(currentTime / totalDuration) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>🎬 Video: {formatTime(videoStart)} - {formatTime(videoStart + (videoDuration || videoMetadata?.duration || 0))}</span>
              <span>🎵 Audio: {formatTime(audioStart)} - {formatTime(audioStart + (audioDuration || audioMetadata?.duration || 0))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}