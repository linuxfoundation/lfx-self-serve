// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingPrivacyType, MeetingVisibility } from '../enums';

export interface MeetingPrivacyFields {
  visibility: MeetingVisibility;
  restricted: boolean;
}

/** Maps the unified privacy selector to the ITX `visibility` + `restricted` pair. */
export function privacyTypeToFields(privacyType: MeetingPrivacyType): MeetingPrivacyFields {
  switch (privacyType) {
    case MeetingPrivacyType.PUBLIC:
      return { visibility: MeetingVisibility.PUBLIC, restricted: false };
    case MeetingPrivacyType.PRIVATE:
      return { visibility: MeetingVisibility.PRIVATE, restricted: false };
    case MeetingPrivacyType.RESTRICTED:
      return { visibility: MeetingVisibility.PRIVATE, restricted: true };
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
