// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingPrivacyType, MeetingVisibility } from '../enums';
import { MeetingPrivacyFields } from '../interfaces/meeting.interface';

/** Maps the unified privacy selector to the ITX `visibility` + `restricted` pair. */
export function privacyTypeToFields(privacyType: MeetingPrivacyType | null | undefined): MeetingPrivacyFields {
  switch (privacyType) {
    case MeetingPrivacyType.PUBLIC:
      return { visibility: MeetingVisibility.PUBLIC, restricted: false };
    case MeetingPrivacyType.PRIVATE:
      return { visibility: MeetingVisibility.PRIVATE, restricted: false };
    case MeetingPrivacyType.RESTRICTED:
      return { visibility: MeetingVisibility.PRIVATE, restricted: true };
    default:
      return { visibility: MeetingVisibility.PRIVATE, restricted: false };
  }
}

/** Derives the privacy selector value from stored meeting fields (PCC parity). */
export function fieldsToPrivacyType(visibility: MeetingVisibility | string | null | undefined, restricted: boolean | null | undefined): MeetingPrivacyType {
  if (restricted) {
    return MeetingPrivacyType.RESTRICTED;
  }
  if (visibility === MeetingVisibility.PUBLIC || visibility === 'public') {
    return MeetingPrivacyType.PUBLIC;
  }
  return MeetingPrivacyType.PRIVATE;
}

/** True when a Private visibility label/badge should be shown (includes null/unknown legacy data). */
export function shouldShowPrivateMeetingLabel(visibility: MeetingVisibility | string | null | undefined): boolean {
  return visibility !== MeetingVisibility.PUBLIC && visibility !== 'public';
}

/** True when a Restricted join label/badge should be shown. */
export function shouldShowRestrictedMeetingLabel(restricted: boolean | null | undefined): boolean {
  return restricted === true;
}
