import Lipsync from './Lipsync';

interface Props {
  comfyUrl: string;
}

export default function LipsyncMultiPerson({ comfyUrl }: Props) {
  return <Lipsync comfyUrl={comfyUrl} initialMode="multi-person" />;
}
