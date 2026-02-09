import Lipsync from './Lipsync';

interface Props {
  comfyUrl: string;
}

export default function VideoLipsync({ comfyUrl }: Props) {
  return <Lipsync comfyUrl={comfyUrl} initialMode="video-lipsync" />;
}
