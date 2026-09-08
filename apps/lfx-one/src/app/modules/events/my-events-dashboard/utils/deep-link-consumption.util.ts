// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EventTabId } from '@lfx-one/shared/interfaces';

/**
 * Key for `consumedDeepLinkEventIds` (PR #2247 review, Copilot) — an eventId alone isn't unique
 * across tabs, so a `visa-letters&event=X` deep link consumed first must not also suppress a
 * later `travel-funding&event=X` deep link for the same event.
 */
export function buildDeepLinkKey(tab: EventTabId, eventId: string): string {
  return `${tab}:${eventId}`;
}
