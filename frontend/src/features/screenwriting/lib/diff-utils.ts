import { diffLines, type Change } from 'diff';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

/**
 * Line-level diff for screenplay text content.
 * Returns Change[] from the diff library.
 */
export function diffScreenplayContent(before: string, after: string): Change[] {
  return diffLines(before, after);
}

/**
 * Field-level diff for structured phase data content.
 * Compares each key with JSON.stringify (shallow key-value JSON).
 */
export function diffStructuredFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Array.from(allKeys).map((field) => ({
    field,
    before: before[field] ?? null,
    after: after[field] ?? null,
    changed: JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  }));
}
