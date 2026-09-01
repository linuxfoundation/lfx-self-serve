// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Formation } from '../interfaces/formation.interface';

/**
 * Builds the staff-facing "create this project in the admin tool" link for a formation whose
 * `project_uid` is still null (the Epic 1 "Record not yet created" fallback state — #1962). This
 * is a CREATE link, not a lookup: `getProjectSfidByUid`/`lfx.lookup_v1_mapping` resolve an
 * *existing* v1 record, which doesn't exist here yet.
 *
 * PCC's actual create-project URL/query-param contract isn't visible from this repo — the path
 * and params below are a best guess, isolated here so they're a one-line fix once confirmed
 * (flagged in the PR the same way the field list is flagged).
 *
 * `pccBaseUrl` is passed in (rather than read from `environment` here) so this stays usable from
 * both the Angular client and, if #1958's queue wants it, anywhere else that already knows the
 * admin-tool base URL.
 */
export function buildFormationAdminToolLink(pccBaseUrl: string, formation: Pick<Formation, 'uid' | 'parent_project_uid' | 'intake'>): string {
  const base = pccBaseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({
    name: formation.intake.project_name,
    source: 'self-serve-proposal',
    formation_uid: formation.uid,
  });
  if (formation.parent_project_uid) {
    params.set('parent', formation.parent_project_uid);
  }
  return `${base}/project/new?${params.toString()}`;
}
