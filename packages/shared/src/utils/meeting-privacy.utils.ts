// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '../enums';

/** True when a Private visibility label/badge should be shown (includes null/unknown legacy data). */
export function shouldShowPrivateMeetingLabel(visibility: MeetingVisibility | string | null | undefined): boolean {
  return visibility !== MeetingVisibility.PUBLIC && visibility !== 'public';
}

/** True when a Restricted join label/badge should be shown. */
export function shouldShowRestrictedMeetingLabel(restricted: boolean | null | undefined): boolean {
  return restricted === true;
}
