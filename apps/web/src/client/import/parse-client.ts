import { ImportParseError, parseImportFile, type Delimiter, type ParsedFile } from './parse';
import type { ParseResponse } from './parse.worker';

/**
 * Parses off the main thread when Workers exist (10,000 rows must not freeze the UI); otherwise,
 * and if the worker fails to start, parses inline.
 */
export function parseInWorker(
  bytes: Uint8Array,
  overrides: { delimiter?: Delimiter; hasHeader?: boolean } = {},
): Promise<ParsedFile> {
  const inline = () => {
    try {
      return Promise.resolve(parseImportFile(bytes, overrides));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  if (typeof Worker === 'undefined') return inline();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return inline().then(resolve, reject);
    }
    worker.onmessage = (e: MessageEvent<ParseResponse>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else
        reject(
          e.data.code === 'unknown' ? new Error('parse failed') : new ImportParseError(e.data.code),
        );
    };
    worker.onerror = () => {
      worker.terminate();
      inline().then(resolve, reject);
    };
    worker.postMessage({ bytes, ...overrides });
  });
}
