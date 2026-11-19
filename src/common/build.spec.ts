import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP_VERSION, BUILD_TAG } from './build';

const pkg = (p: string) => JSON.parse(readFileSync(join(__dirname, '..', '..', p), 'utf-8'));

describe('app version', () => {
  it('is 1.8.0 and the same in the server, both package.json files and the console', () => {
    expect(APP_VERSION).toBe('1.8.0');
    expect(BUILD_TAG).toBe(APP_VERSION);
    expect(pkg('package.json').version).toBe(APP_VERSION);
    expect(pkg('console-ui/package.json').version).toBe(APP_VERSION);
    expect(pkg('package-lock.json').version).toBe(APP_VERSION);
    expect(pkg('console-ui/package-lock.json').version).toBe(APP_VERSION);
  });
});
