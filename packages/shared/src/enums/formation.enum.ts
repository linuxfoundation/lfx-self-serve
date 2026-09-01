// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Formation lifecycle state (Epic 1, GH-1962/#1965). Only `PROPOSED` is ever produced by the
 * intake form's fixture-backed fallback path today — the remaining values exist so the type is
 * ready for the formation service (#1957) and the checklist/queue (#1958) once they land.
 */
export enum FormationState {
  PROPOSED = 'proposed',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
}
