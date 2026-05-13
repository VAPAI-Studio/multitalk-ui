// frontend/src/lib/textHighlight.ts
// Pure text-segmentation utility for highlighting breakdown elements in script text.
// No React dependency — only types.

import type { BreakdownCategory, BreakdownElement } from '../types';

export interface ElementMatch {
  elementId: string;
  elementName: string;
  category: BreakdownCategory;
}

export interface TextSegment {
  type: 'text' | 'highlight';
  content: string;
  match?: ElementMatch;
}

/**
 * Escape regex metacharacters in a string so it can be safely used
 * inside a RegExp constructor.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split `text` into an array of plain-text and highlighted segments
 * based on the names of the given breakdown elements.
 *
 * - Case-insensitive, whole-word matching via `\b` word boundaries.
 * - Longest match wins (elements sorted by name length descending).
 * - Deleted elements and elements with empty names are filtered out.
 */
export function buildHighlightSegments(
  text: string,
  elements: BreakdownElement[],
): TextSegment[] {
  if (!elements.length || !text) {
    return [{ type: 'text', content: text }];
  }

  // Filter to non-deleted elements with non-empty trimmed names
  const sorted = [...elements]
    .filter((e) => e.name.trim().length > 0 && !e.is_deleted)
    .sort((a, b) => b.name.length - a.name.length);

  if (!sorted.length) {
    return [{ type: 'text', content: text }];
  }

  // Build case-insensitive lookup: lowercased name -> element
  const lookup = new Map<string, BreakdownElement>();
  for (const el of sorted) {
    lookup.set(el.name.toLowerCase(), el);
  }

  // Build regex alternation (longest first for ordered matching)
  const pattern = sorted.map((e) => escapeRegex(e.name)).join('|');
  const regex = new RegExp(`\\b(${pattern})\\b`, 'gi');

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    const matchedText = match[0];
    const element = lookup.get(matchedText.toLowerCase());

    if (element) {
      segments.push({
        type: 'highlight',
        content: matchedText,
        match: {
          elementId: element.id,
          elementName: element.name,
          category: element.category,
        },
      });
    } else {
      // Fallback: render as plain text if lookup fails
      segments.push({ type: 'text', content: matchedText });
    }

    lastIndex = regex.lastIndex;
  }

  // Append remaining text after the last match
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments;
}
