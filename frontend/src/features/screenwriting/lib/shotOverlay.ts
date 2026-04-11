import type { Shot } from '../types';

export interface ShotOverlayRange {
  start: number;
  end: number;
  shots: Shot[];
}

/**
 * Build overlay ranges indicating which character spans of `text` are
 * referenced by one or more shots via their `script_text` field.
 *
 * Returns merged, non-overlapping ranges sorted by `start` ascending.
 * Each range carries the list of shots that reference any character in that span.
 */
export function buildShotOverlayRanges(text: string, shots: Shot[]): ShotOverlayRange[] {
  if (!text || shots.length === 0) return [];

  // Filter to shots with non-empty script_text
  const relevantShots = shots.filter(s => s.script_text && s.script_text.trim().length > 0);
  if (relevantShots.length === 0) return [];

  // Character-level coverage: each position tracks the set of shots covering it
  const coverage: Array<Set<Shot>> = new Array(text.length);

  for (const shot of relevantShots) {
    const needle = shot.script_text.trim();
    if (needle.length === 0) continue;

    let searchFrom = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const idx = text.indexOf(needle, searchFrom);
      if (idx === -1) break;
      for (let i = idx; i < idx + needle.length && i < text.length; i++) {
        if (!coverage[i]) {
          coverage[i] = new Set();
        }
        coverage[i].add(shot);
      }
      searchFrom = idx + 1;
    }
  }

  // Merge contiguous covered characters into ranges
  const ranges: ShotOverlayRange[] = [];
  let rangeStart = -1;
  let rangeShots = new Set<Shot>();

  for (let i = 0; i <= text.length; i++) {
    const covered = i < text.length && coverage[i] && coverage[i].size > 0;

    if (covered) {
      if (rangeStart === -1) {
        rangeStart = i;
        rangeShots = new Set(coverage[i]);
      } else {
        // Accumulate shots from this position into the current range
        for (const s of coverage[i]) {
          rangeShots.add(s);
        }
      }
    } else {
      if (rangeStart !== -1) {
        ranges.push({
          start: rangeStart,
          end: i,
          shots: Array.from(rangeShots),
        });
        rangeStart = -1;
        rangeShots = new Set();
      }
    }
  }

  // Sort by start ascending (should already be, but be explicit)
  ranges.sort((a, b) => a.start - b.start);

  return ranges;
}
