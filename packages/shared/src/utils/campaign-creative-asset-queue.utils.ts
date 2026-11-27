// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CreativeAssetQueueItemStatus } from '../interfaces/campaign.interface';

/**
 * Whether a library upload may start now: this deployment admits uploads (`available`, where `null` is not a yes) and
 * no stored asset's delete is running. An upload of identical bytes answers with the asset already stored, so one sent
 * during a delete could name the asset that delete is about to remove (campaign-service#665).
 */
export function creativeAssetUploadAllowed(available: boolean | null, deleteRunning: boolean): boolean {
  return available === true && !deleteRunning;
}

/** Whether a library queue item offers Retry: it failed or was cancelled, and an upload may start now (`creativeAssetUploadAllowed`). */
export function creativeAssetQueueRetryable(status: CreativeAssetQueueItemStatus, available: boolean | null, deleteRunning: boolean): boolean {
  return creativeAssetUploadAllowed(available, deleteRunning) && (status === 'failed' || status === 'cancelled');
}
