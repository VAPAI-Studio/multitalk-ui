import { Construction } from 'lucide-react';

interface PlaceholderViewProps {
  title: string;
  description: string;
  pattern: string;
}

export function PlaceholderView({ title, description, pattern }: PlaceholderViewProps) {
  return (
    <div className="flex items-center justify-center h-full animate-fade-in">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted mb-4">
          <Construction className="h-5 w-5 text-muted-foreground" />
        </div>
        <h3 className="font-display text-lg font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground mb-3">{description}</p>
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-mono text-muted-foreground bg-muted border border-border">
          {pattern}
        </span>
      </div>
    </div>
  );
}
