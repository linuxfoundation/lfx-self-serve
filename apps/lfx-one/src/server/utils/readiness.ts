// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BROWSER_ENTRY_SCRIPT_PATTERN, BROWSER_ENTRY_STYLE_PATTERN, BROWSER_SHELL_FILENAMES } from '@lfx-one/shared/constants';
import { BrowserBundleReadiness } from '@lfx-one/shared/interfaces';
import { readdirSync } from 'node:fs';

import { logger } from '../services/logger.service';

let browserBundleReady = false;
let lastNotReadyReason: string | undefined;

/**
 * Reports whether the browser dist can serve the HTML shell, the entry script and the global stylesheet.
 *
 * Only a success is cached: once the files are present the probe does no I/O, and until then each
 * probe re-reads the directory so a pod that was not ready recovers on its own. The failure is logged
 * once per distinct reason, not once per probe.
 */
export function checkBrowserBundleReady(browserDistFolder: string): BrowserBundleReadiness {
  if (browserBundleReady) {
    return { ready: true };
  }

  const result = inspectBrowserBundle(browserDistFolder);

  if (result.ready) {
    browserBundleReady = true;
    lastNotReadyReason = undefined;
    return result;
  }

  if (result.reason !== lastNotReadyReason) {
    lastNotReadyReason = result.reason;
    logger.warning(undefined, 'readiness_check_failed', 'Browser bundle is incomplete, pod is not ready', { reason: result.reason });
  }

  return result;
}

// Clears the cached success and last logged reason (useful in tests).
export function resetBrowserBundleReadinessForTests(): void {
  browserBundleReady = false;
  lastNotReadyReason = undefined;
}

function inspectBrowserBundle(browserDistFolder: string): BrowserBundleReadiness {
  let files: string[];
  try {
    files = readdirSync(browserDistFolder);
  } catch {
    return { ready: false, reason: 'browser_dist_missing' };
  }

  if (!BROWSER_SHELL_FILENAMES.some((name) => files.includes(name))) {
    return { ready: false, reason: 'shell_missing' };
  }
  if (!files.some((file) => BROWSER_ENTRY_SCRIPT_PATTERN.test(file))) {
    return { ready: false, reason: 'main_bundle_missing' };
  }
  if (!files.some((file) => BROWSER_ENTRY_STYLE_PATTERN.test(file))) {
    return { ready: false, reason: 'styles_bundle_missing' };
  }

  return { ready: true };
}
