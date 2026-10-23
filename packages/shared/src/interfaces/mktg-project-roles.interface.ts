// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Request-local role data, not an HTTP response or a persisted record. */
export interface MktgProjectRole {
  name: string | null;
  /** Directory-resolved opaque subject only. Null means unresolved, never authorization. */
  subject: string | null;
}

/** No assignment or an ambiguous roster is null; a known person may have an unresolved subject. */
export interface MktgProjectRoles {
  ed: MktgProjectRole | null;
  tocChair: MktgProjectRole | null;
}
