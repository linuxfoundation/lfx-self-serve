// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { CreativeAssetQueueItemStatus } from '../interfaces/campaign.interface';
import { creativeAssetQueueRetryable, creativeAssetUploadAllowed } from './campaign-creative-asset-queue.utils';

describe('creativeAssetUploadAllowed', () => {
  it.each([
    ['uploads admitted, no delete running', true, false, true],
    ['a delete running', true, true, false],
    ['the capability unanswered', null, false, false],
    ['uploads not admitted', false, false, false],
  ])('%s', (_label, available, deleteRunning, expected) => {
    expect(creativeAssetUploadAllowed(available, deleteRunning)).toBe(expected);
  });
});

describe('creativeAssetQueueRetryable', () => {
  it.each<[string, CreativeAssetQueueItemStatus, boolean | null, boolean, boolean]>([
    ['a failed upload', 'failed', true, false, true],
    ['a cancelled upload', 'cancelled', true, false, true],
    ['a failed upload while a delete runs', 'failed', true, true, false],
    ['a failed upload with the capability unanswered', 'failed', null, false, false],
    ['a refused upload', 'refused', true, false, false],
    ['a stored upload', 'uploaded', true, false, false],
  ])('%s', (_label, status, available, deleteRunning, expected) => {
    expect(creativeAssetQueueRetryable(status, available, deleteRunning)).toBe(expected);
  });
});
