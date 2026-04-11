import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildHighlightSegments, type TextSegment } from '../../lib/textHighlight';
import { buildShotOverlayRanges, type ShotOverlayRange } from '../../lib/shotOverlay';
import { ShotOverlayPopover } from './ShotOverlayPopover';
import { ROUTES, BREAKDOWN_CATEGORIES } from '../../lib/constants';
import type { BreakdownElement, Shot } from '../../types';

interface HighlightedScriptTextProps {
  text: string;
  elements: BreakdownElement[];
  projectId: string;
  shots?: Shot[];
  hoveredShotId?: string | null;
}

/**
 * Split a segment's character range into sub-pieces based on which parts
 * fall within shot overlay ranges. Returns an array of sub-pieces, each
 * annotated with the matching ShotOverlayRange (or null if uncovered).
 */
function splitSegmentByShotRanges(
  segContent: string,
  segStart: number,
  shotRanges: ShotOverlayRange[],
): Array<{ text: string; shotRange: ShotOverlayRange | null }> {
  const segEnd = segStart + segContent.length;

  // Find overlapping ranges
  const overlapping = shotRanges.filter(r => r.start < segEnd && r.end > segStart);

  if (overlapping.length === 0) {
    return [{ text: segContent, shotRange: null }];
  }

  const pieces: Array<{ text: string; shotRange: ShotOverlayRange | null }> = [];
  let cursor = segStart;

  for (const range of overlapping) {
    // Uncovered gap before this range
    const overlapStart = Math.max(range.start, segStart);
    if (cursor < overlapStart) {
      pieces.push({
        text: segContent.slice(cursor - segStart, overlapStart - segStart),
        shotRange: null,
      });
    }

    // Covered part
    const overlapEnd = Math.min(range.end, segEnd);
    pieces.push({
      text: segContent.slice(Math.max(range.start, segStart) - segStart, overlapEnd - segStart),
      shotRange: range,
    });

    cursor = overlapEnd;
  }

  // Trailing uncovered gap
  if (cursor < segEnd) {
    pieces.push({
      text: segContent.slice(cursor - segStart),
      shotRange: null,
    });
  }

  return pieces;
}

export function HighlightedScriptText({ text, elements, projectId, shots, hoveredShotId }: HighlightedScriptTextProps) {
  const navigate = useNavigate();
  const [popoverState, setPopoverState] = useState<{ shots: Shot[]; rect: DOMRect } | null>(null);

  const segments = useMemo(
    () => buildHighlightSegments(text, elements),
    [text, elements],
  );

  const shotRanges = useMemo(
    () => buildShotOverlayRanges(text, shots ?? []),
    [text, shots],
  );

  const handleShotOverlayClick = useCallback((e: React.MouseEvent, overlayShots: Shot[]) => {
    // Don't open popover if user clicked an element highlight
    if ((e.target as HTMLElement).closest('.element-highlight')) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopoverState({ shots: overlayShots, rect });
  }, []);

  // Render a single sub-piece, optionally wrapping with element-highlight props
  const renderSubSpan = (
    piece: { text: string; shotRange: ShotOverlayRange | null },
    seg: TextSegment,
    key: string,
  ) => {
    const isElementHighlight = seg.type === 'highlight' && seg.match;
    const hasShotOverlay = piece.shotRange !== null;

    const classNames: string[] = [];
    if (isElementHighlight) {
      classNames.push('element-highlight', `element-highlight--${seg.match!.category}`);
    }
    if (hasShotOverlay) {
      classNames.push('shot-overlay');
      if (hoveredShotId && piece.shotRange!.shots.some(s => s.id === hoveredShotId)) {
        classNames.push('shot-overlay--hovered');
      }
    }

    const className = classNames.length > 0 ? classNames.join(' ') : undefined;

    // Build event handlers
    const onClick = isElementHighlight
      ? (e: React.MouseEvent) => {
          e.stopPropagation();
          window.getSelection()?.removeAllRanges();
          navigate(ROUTES.ELEMENT_DETAIL(projectId, seg.match!.elementId));
        }
      : hasShotOverlay
        ? (e: React.MouseEvent) => handleShotOverlayClick(e, piece.shotRange!.shots)
        : undefined;

    const title = isElementHighlight
      ? `${seg.match!.elementName} - ${BREAKDOWN_CATEGORIES.find((c) => c.value === seg.match!.category)?.label ?? seg.match!.category}`
      : undefined;

    return (
      <span key={key} className={className} title={title} onClick={onClick}>
        {piece.text}
      </span>
    );
  };

  // Track cumulative character offset across segments
  let charOffset = 0;

  return (
    <>
      {segments.map((seg, segIdx) => {
        const segStart = charOffset;
        charOffset += seg.content.length;

        // If no shot overlay ranges at all, render the simple path
        if (shotRanges.length === 0) {
          if (seg.type === 'text') {
            return <span key={segIdx}>{seg.content}</span>;
          }
          return (
            <span
              key={segIdx}
              className={`element-highlight element-highlight--${seg.match!.category}`}
              title={`${seg.match!.elementName} - ${BREAKDOWN_CATEGORIES.find((c) => c.value === seg.match!.category)?.label ?? seg.match!.category}`}
              onClick={(e) => {
                e.stopPropagation();
                window.getSelection()?.removeAllRanges();
                navigate(ROUTES.ELEMENT_DETAIL(projectId, seg.match!.elementId));
              }}
            >
              {seg.content}
            </span>
          );
        }

        // Split this segment by shot overlay ranges
        const pieces = splitSegmentByShotRanges(seg.content, segStart, shotRanges);

        // If only one piece with no shot range and it's plain text, simple render
        if (pieces.length === 1 && pieces[0].shotRange === null && seg.type === 'text') {
          return <span key={segIdx}>{seg.content}</span>;
        }

        // If only one piece, render directly without wrapper
        if (pieces.length === 1) {
          return renderSubSpan(pieces[0], seg, String(segIdx));
        }

        // Multiple pieces: render each as a sub-span
        return pieces.map((piece, pieceIdx) =>
          renderSubSpan(piece, seg, `${segIdx}-${pieceIdx}`),
        );
      })}

      {popoverState && (
        <ShotOverlayPopover
          shots={popoverState.shots}
          rect={popoverState.rect}
          onDismiss={() => setPopoverState(null)}
        />
      )}
    </>
  );
}
