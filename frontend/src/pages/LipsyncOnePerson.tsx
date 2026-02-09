import Lipsync from './Lipsync';

interface Props {
  comfyUrl: string;
}

export default function LipsyncOnePerson({ comfyUrl }: Props) {
  return <Lipsync comfyUrl={comfyUrl} initialMode="one-person" />;
}
