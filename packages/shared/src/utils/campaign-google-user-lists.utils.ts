// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GOOGLE_USER_LIST_TYPE_LABELS } from '../constants/campaign.constants';
import type { GoogleAdsUserListOption } from '../interfaces/campaign.interface';

/**
 * The Implement tab's audience segment picker (#5244) over the `googleAudienceSegments` list, which
 * stays the one thing the request is built from: one `customers/{id}/userLists/{id}` resource name
 * per entry. Picking a list adds its resource name exactly as typing it would, so a create sends the
 * same request either way.
 */

/**
 * What the picker shows for one list: its name, its type in words, and a warning when Google reports
 * it cannot serve on Search (the only channel that takes audience segments here).
 */
export function googleUserListLabel(list: GoogleAdsUserListOption): string {
  const type = GOOGLE_USER_LIST_TYPE_LABELS[list.type] ?? sentenceCase(list.type);
  const words = type === '' ? '' : ` · ${type}`;
  return `${list.name}${words}${list.eligibleForSearch === false ? ' · not eligible for Search' : ''}`;
}

function sentenceCase(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words === '' ? '' : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The listed user lists not already among `picked`, in list order: the rows the picker still offers. */
export function googleUnpickedUserLists<T extends GoogleAdsUserListOption>(lists: readonly T[], picked: readonly string[]): T[] {
  const taken = new Set(picked);
  return lists.filter((list) => !taken.has(list.resourceName));
}
