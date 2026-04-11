import { useRef, useState, useEffect } from 'react';
import { Play, Pause, Square } from 'lucide-react';

interface AudioPlayerProps {
  src: string;
  filename: string;
  mediaId: string;
  onPlaybackStart: (mediaId: string, stopFn: () => void) => void;
}

export function AudioPlayer({ src, filename, mediaId, onPlaybackStart }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  };

  const play = () => {
    onPlaybackStart(mediaId, stop);
    audioRef.current?.play();
    setIsPlaying(true);
  };

  const pause = () => {
    audioRef.current?.pause();
    setIsPlaying(false);
  };

  // Cleanup: pause audio on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      audioRef.current?.pause();
    };
  }, []);

  return (
    <div className="flex items-center gap-2 rounded-lg bg-card/60 border border-border/50 px-3 py-2">
      <audio ref={audioRef} src={src} onEnded={() => setIsPlaying(false)} preload="none" />
      {isPlaying ? (
        <button
          onClick={pause}
          className="h-8 w-8 flex items-center justify-center text-primary hover:bg-muted rounded-md transition-colors"
          aria-label="Pause audio"
        >
          <Pause className="h-4 w-4" />
        </button>
      ) : (
        <button
          onClick={play}
          className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          aria-label="Play audio"
        >
          <Play className="h-4 w-4" />
        </button>
      )}
      <button
        onClick={stop}
        className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        aria-label="Stop audio"
      >
        <Square className="h-3.5 w-3.5" />
      </button>
      <span className="text-xs text-muted-foreground truncate flex-1">{filename}</span>
    </div>
  );
}
