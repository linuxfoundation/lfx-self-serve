// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Request-local role data, never persisted. Display name/username only; authorize exclusively on subject. */
export interface MktgProjectRole {
  /** TOC display fields follow the caller's committee-roster visibility; subject is not a display field. */
  name: string | null;
  username?: string;
  /** Directory-resolved opaque subject only. Null means unresolved, never authorization. */
  subject: string | null;
}

/** No assignment or an ambiguous roster is null; a known person may have an unresolved subject. */
export interface MktgProjectRoles {
  ed: MktgProjectRole | null;
  tocChair: MktgProjectRole | null;
}
