/**
 * Where a governed model appears in source: every file it was discovered in,
 * with the line numbers of the evidence the scanner found there.
 */
import { DiscoveredCandidate } from './codebase-scanner';

export interface SourceLocation {
  file: string;
  /** Sorted, unique 1-based line numbers. Empty when only the file is known. */
  lines: number[];
}

const cleanLines = (lines: unknown[]): number[] =>
  [...new Set(lines.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);

/** Lines in one scanned file where the model shows up: detection signals,
 *  tool invocations and hardcoded secrets. */
export function locationOfCandidate(cand: DiscoveredCandidate): SourceLocation {
  return {
    file: cand.filePath,
    lines: cleanLines([
      ...cand.signals.map((s) => s.lineNumber),
      ...cand.toolDetails.map((t) => t.line),
      ...cand.secrets.map((s) => s.line),
    ]),
  };
}

/** Insert or refresh one file's entry; other files keep their place and lines. */
export function upsertLocation(existing: SourceLocation[] | null | undefined, loc: SourceLocation): SourceLocation[] {
  const out = (existing ?? []).filter((l) => l.file !== loc.file);
  const idx = (existing ?? []).findIndex((l) => l.file === loc.file);
  if (idx === -1) out.push(loc);
  else out.splice(idx, 0, loc);
  return out;
}

/**
 * Every file a model record covers, with lines where known. Records imported
 * before line tracking only have file names (sourceRefs / sourceRef); those
 * files are still listed, with no lines, until the next scan fills them in.
 */
export function sourceLocationsOf(m: {
  sourceLocations?: SourceLocation[] | null;
  sourceRefs?: string[] | null;
  sourceRef?: string | null;
}): SourceLocation[] {
  const files = m.sourceRefs ?? (m.sourceRef ? [m.sourceRef] : []);
  const byFile = new Map((m.sourceLocations ?? []).map((l) => [l.file, l]));
  const out: SourceLocation[] = files.map((f) => ({ file: f, lines: byFile.get(f)?.lines ?? [] }));
  for (const l of m.sourceLocations ?? []) {
    if (!files.includes(l.file)) out.push({ file: l.file, lines: l.lines ?? [] });
  }
  return out;
}
