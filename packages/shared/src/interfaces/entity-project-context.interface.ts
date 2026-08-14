// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Minimal shape required for syncing project context from an entity detail signal. */
export interface EntityWithProject {
  uid: string;
  project_uid: string;
  project_slug?: string | null;
  project_name?: string | null;
  foundation_name?: string | null;
  /** Whether the owning project is a foundation. When non-null it drives the
   * setFoundation/setProject choice in syncEntityProjectContext; when absent the
   * /foundation/* URL-prefix heuristic is the fallback. */
  is_foundation?: boolean | null;
}
