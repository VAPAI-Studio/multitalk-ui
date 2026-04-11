import { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { BREAKDOWN_CATEGORIES } from '../../lib/constants';
import type { BreakdownSummary, BreakdownRun } from '../../types';
import type { UseMutationResult } from '@tanstack/react-query';
import { ElementList } from './ElementList';

interface CategoryTabsProps {
  projectId: string;
  summary: BreakdownSummary | undefined;
  extractMutation: UseMutationResult<BreakdownRun, Error, void, unknown>;
}

export function CategoryTabs({ projectId, summary, extractMutation }: CategoryTabsProps) {
  const [activeCategory, setActiveCategory] = useState<string>('character');

  return (
    <Tabs.Root value={activeCategory} onValueChange={setActiveCategory} className="flex flex-col flex-1 min-h-0">
      <Tabs.List className="flex items-center gap-0.5 border-b border-border px-6 flex-shrink-0 bg-card/30">
        {BREAKDOWN_CATEGORIES.map(cat => (
          <Tabs.Trigger
            key={cat.value}
            value={cat.value}
            className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider
              border-b-2 -mb-px transition-colors outline-none
              data-[state=active]:border-amber-400 data-[state=active]:text-amber-400
              data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground/60
              hover:text-muted-foreground"
          >
            {cat.label}
            <span className="ml-1 text-[10px] bg-muted/60 px-1.5 py-0.5 rounded-full tabular-nums">
              {summary?.counts_by_category[cat.value] ?? 0}
            </span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      {BREAKDOWN_CATEGORIES.map(cat => (
        <Tabs.Content key={cat.value} value={cat.value} className="flex-1 overflow-y-auto outline-none">
          <ElementList
            projectId={projectId}
            category={cat.value}
            isActive={activeCategory === cat.value}
            extractMutation={extractMutation}
          />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
