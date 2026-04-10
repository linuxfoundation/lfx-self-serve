// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Event status values used across the Foundation Lens events feature.
 *
 * This enum intentionally covers two conceptual groups:
 *
 * **Raw DB values** (EVENT_STATUS column in SILVER_DIM.EVENTS) — used only in the
 * server-side SQL query and in `EventStatusFilter` type for API param validation:
 *   - ACTIVE, PLANNED, PENDING, COMPLETED
 *
 * **Display labels** (shown in the UI after client-side mapping) — used in the
 * events-table component for severity lookups, action labels, and outline logic:
 *   - REGISTRATION_OPEN (maps from ACTIVE)
 *   - COMING_SOON       (maps from PENDING and PLANNED)
 *   - COMPLETED         (same value as the raw DB status)
 *
 * Raw values are never compared against display labels in the same context.
 */
export enum FoundationEventStatus {
  /** Raw DB values — used for SQL filtering only */
  PLANNED = 'Planned',
  PENDING = 'Pending',
  COMPLETED = 'Completed',
  ACTIVE = 'Active',
  /** Display labels — used in UI comparisons after client-side mapping */
  REGISTRATION_OPEN = 'Registration Open',
  COMING_SOON = 'Coming Soon',
}
