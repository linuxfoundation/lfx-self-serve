// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { warning: vi.fn() },
}));

import { logger } from '../services/logger.service';
import { checkBrowserBundleReady, resetBrowserBundleReadinessForTests } from './readiness';

describe('checkBrowserBundleReady', () => {
  let distFolder: string;

  const touch = (...names: string[]): void => {
    for (const name of names) {
      writeFileSync(join(distFolder, name), '');
    }
  };

  beforeEach(() => {
    distFolder = mkdtempSync(join(tmpdir(), 'lfx-readiness-'));
    resetBrowserBundleReadinessForTests();
    vi.mocked(logger.warning).mockClear();
  });

  afterEach(() => {
    rmSync(distFolder, { recursive: true, force: true });
  });

  it('is not ready when the browser dist folder does not exist', () => {
    expect(checkBrowserBundleReady(join(distFolder, 'missing'))).toEqual({ ready: false, reason: 'browser_dist_missing' });
  });

  it('is not ready without the HTML shell', () => {
    touch('main-ABCDEFGH.js', 'styles-ABCDEFGH.css');

    expect(checkBrowserBundleReady(distFolder)).toEqual({ ready: false, reason: 'shell_missing' });
  });

  it('is not ready without the main script', () => {
    touch('index.csr.html', 'styles-ABCDEFGH.css');

    expect(checkBrowserBundleReady(distFolder)).toEqual({ ready: false, reason: 'main_bundle_missing' });
  });

  it('is not ready without the global stylesheet', () => {
    touch('index.csr.html', 'main-ABCDEFGH.js');

    expect(checkBrowserBundleReady(distFolder)).toEqual({ ready: false, reason: 'styles_bundle_missing' });
  });

  it('accepts unhashed entry files from a build without outputHashing', () => {
    touch('index.csr.html', 'main.js', 'styles.css');

    expect(checkBrowserBundleReady(distFolder)).toEqual({ ready: true });
  });

  it('ignores nested bundles, source maps and short hashes', () => {
    touch('index.csr.html', 'styles-ABCDEFGH.css', 'main.js.map', 'main-ABC.js');
    mkdirSync(join(distFolder, 'nested'));
    writeFileSync(join(distFolder, 'nested', 'main-ABCDEFGH.js'), '');

    expect(checkBrowserBundleReady(distFolder)).toEqual({ ready: false, reason: 'main_bundle_missing' });
  });

  it('is ready with the SSR client shell and hashed entry assets', () => {
    touch('index.csr.html', 'main-ABCDEFGH.js', 'styles-ABCDEFGH.css');

    expect(checkBrowserBundleReady(distFolder)).toEqual({ ready: true });
  });

  it('is ready with a plain index.html shell', () => {
    touch('index.html', 'main-ABCDEFGH.js', 'styles-ABCDEFGH.css');

    expect(checkBrowserBundleReady(distFolder)).toEqual({ ready: true });
  });

  it('recovers once the missing files appear', () => {
    touch('index.csr.html');
    expect(checkBrowserBundleReady(distFolder).ready).toBe(false);

    touch('main-ABCDEFGH.js', 'styles-ABCDEFGH.css');
    expect(checkBrowserBundleReady(distFolder)).toEqual({ ready: true });
  });

  it('caches a success so later probes do no file reads', () => {
    touch('index.csr.html', 'main-ABCDEFGH.js', 'styles-ABCDEFGH.css');
    expect(checkBrowserBundleReady(distFolder).ready).toBe(true);

    rmSync(distFolder, { recursive: true, force: true });

    expect(checkBrowserBundleReady(distFolder)).toEqual({ ready: true });
  });

  it('logs a failure once per distinct reason, not once per probe', () => {
    checkBrowserBundleReady(distFolder);
    checkBrowserBundleReady(distFolder);
    expect(logger.warning).toHaveBeenCalledTimes(1);

    touch('index.csr.html');
    checkBrowserBundleReady(distFolder);
    checkBrowserBundleReady(distFolder);
    expect(logger.warning).toHaveBeenCalledTimes(2);
  });
});
