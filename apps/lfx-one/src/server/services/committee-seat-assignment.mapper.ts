// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Spec 028 (D-101) — shared seat→assignment mapper extracted from `OrgPeopleCommitteeMembersService`
// so both the Committee tab (spec 027) and the Board tab (spec 028) reuse the same foundation-name
// enrichment + camelCase mapping with zero duplication. Behavior is byte-identical to the original
// private methods; the committee read/reassign responses are unchanged.

import type { CommitteeMemberAssignment, CommitteeMemberPerson, CommitteeServiceOrgSeat } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { ProjectService } from './project.service';

/** D-003 foundation-name enrichment: distinct `project_uid`s → `ProjectService.getProjectsByIds` (chunks 100/req, FGA-aware) → `Map<uid, name>`; fail-soft to empty map (each seat falls back to `project_slug`). */
export async function enrichFoundationNames(req: Request, seats: CommitteeServiceOrgSeat[], projectService: ProjectService): Promise<Map<string, string>> {
  const uids = [...new Set(seats.map((s) => s.project_uid).filter((u): u is string => !!u))];
  if (uids.length === 0) {
    return new Map();
  }
  try {
    const byUid = await projectService.getProjectsByIds(req, uids);
    const names = new Map<string, string>();
    for (const [uid, project] of byUid) {
      if (project?.name) {
        names.set(uid, project.name);
      }
    }
    return names;
  } catch (error) {
    logger.warning(req, 'enrich_foundation_names', 'project-name enrichment failed; falling back to project_slug', {
      uid_count: uids.length,
      err: error,
    });
    return new Map();
  }
}

/** Map an upstream seat to the People-tab `CommitteeMemberAssignment` (camelCase + person envelope + foundation). */
export function toAssignment(s: CommitteeServiceOrgSeat, foundationNames: Map<string, string>): CommitteeMemberAssignment {
  const projectUid = s.project_uid ?? '';
  const foundationSlug = s.project_slug ?? '';
  return {
    seatId: s.uid,
    memberUid: s.uid,
    committeeUid: s.committee_uid,
    committeeName: s.committee_name,
    committeeCategory: s.committee_category,
    projectUid,
    foundationSlug,
    foundationName: foundationNames.get(projectUid) || foundationSlug,
    role: s.role_name ?? '',
    votingStatus: s.voting_status ?? '',
    appointedBy: s.appointed_by ?? '',
    isOrgEditable: s.is_org_editable,
    reason: s.reason ?? null,
    person: toPerson(s),
  };
}

/** Build the seat holder's person envelope: lowercased email, fullName fallback to email, derived initials. */
export function toPerson(s: CommitteeServiceOrgSeat): CommitteeMemberPerson {
  const firstName = (s.first_name ?? '').trim();
  const lastName = (s.last_name ?? '').trim();
  const email = (s.email ?? '').trim().toLowerCase();
  const name = `${firstName} ${lastName}`.trim();
  // Members added by email before their profile resolves have no name upstream — fall back to the
  // email as the display name (and derive initials from it) so the row is identifiable, not blank.
  const fullName = name || email;
  const nameInitials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  const initials =
    nameInitials ||
    email
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 2)
      .toUpperCase();
  return {
    email,
    firstName,
    lastName,
    fullName,
    jobTitle: s.job_title?.trim() ? s.job_title.trim() : null,
    initials,
  };
}
