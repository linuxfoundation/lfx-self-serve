// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { logger } from '../services/logger.service';

type ShutdownHook = () => void | Promise<void>;

let shuttingDown = false;
const hooks: ShutdownHook[] = [];

export function isShuttingDown(): boolean {
  return shuttingDown;
}

// Returns a deregistration function — call it to remove the hook (useful in tests).
export function addShutdownHook(hook: ShutdownHook): () => void {
  hooks.push(hook);
  return () => {
    const idx = hooks.indexOf(hook);
    if (idx !== -1) hooks.splice(idx, 1);
  };
}

export function markShuttingDown(): void {
  shuttingDown = true;
}

// Runs all registered hooks concurrently. Call markShuttingDown() first so
// /readyz flips synchronously before hook execution begins.
// Each hook is wrapped in Promise.resolve().then() to convert synchronous throws
// into rejections so allSettled can catch them (plain hooks.map(h => h()) would
// let a sync throw escape before allSettled receives the array).
export async function runShutdownHooks(): Promise<void> {
  const results = await Promise.allSettled(hooks.map((hook) => Promise.resolve().then(() => hook())));
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error(undefined, 'shutdown_hook_failed', Date.now(), result.reason, {});
    }
  }
}
