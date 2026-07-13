// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '../enums';

/**
 * Returns a human-readable label for the combined meeting privacy state.
 * @description Maps the two independent privacy fields (`visibility` + `restricted`)
 * to a single display string matching the PCC privacy matrix:
 * - Public + unrestricted → "Public"
 * - Private + unrestricted → "Private"
 * - Private + restricted  → "Private (Restricted)"
 * - Public + restricted   → "Public (Restricted)"
 */
export function getMeetingPrivacyLabel(visibility: MeetingVisibility | null, restricted: boolean | null): string {
  if (visibility === MeetingVisibility.PRIVATE && restricted) {
    return 'Private (Restricted)';
  }
  if (restricted) {
    return 'Public (Restricted)';
  }
  if (visibility === MeetingVisibility.PRIVATE) {
    return 'Private';
  }
  return 'Public';
}

/**
 * Returns the Font Awesome icon class for the combined meeting privacy state.
 * @description Icon prioritizes restriction state over visibility: `restricted=true` always
 * shows a lock regardless of visibility, matching the PCC join-access model. This differs
 * from `getMeetingPrivacyLabel`, which prioritizes visibility in its primary branches.
 */
export function getMeetingPrivacyIcon(visibility: MeetingVisibility | null, restricted: boolean | null): string {
  if (restricted) {
    return 'fa-light fa-lock';
  }
  if (visibility === MeetingVisibility.PRIVATE) {
    return 'fa-light fa-eye-slash';
  }
  return 'fa-light fa-globe';
}
