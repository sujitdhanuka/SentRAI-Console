import { extname } from 'path';

/** Maps a file path to a language name. Port of language_detector.py. */
export function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.py') return 'python';
  if (ext === '.js' || ext === '.jsx') return 'javascript';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.go') return 'go';
  if (ext === '.java') return 'java';
  if (ext === '.rb') return 'ruby';
  return 'unknown';
}
