// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectCounts } from '../interfaces';

/**
 * A project "has channels" when it has at least one mailing list OR a chat
 * channel configured on any committee. Used by the foundation projects page
 * to drive the Channels column icons and the presence filter pills — a
 * project with only a chat channel (no mailing lists) still counts as
 * "with channels".
 *
 * Resolution rules:
 * - `true` as soon as either field confirms presence (short-circuits even
 *   while the other source is still in-flight).
 * - `undefined` when either field is still pending and no presence has been
 *   confirmed yet — so callers can distinguish "loading" from
 *   "confirmed no channels" and avoid counting unresolved rows as absent.
 * - `false` only once both sources have resolved to `0` / `false`.
 */
export function hasAnyChannel(counts: ProjectCounts | undefined): boolean | undefined {
  if (!counts) return undefined;
  // Confirmed presence short-circuits — don't wait on the other source.
  if (counts.mailingLists !== undefined && counts.mailingLists > 0) return true;
  if (counts.hasChat === true) return true;
  // Either field still pending → channel status is unknown.
  if (counts.mailingLists === undefined || counts.hasChat === undefined) return undefined;
  // Both fields resolved to 0 / false — confirmed no channels.
  return false;
}
