// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Shared seat→assignment mapper extracted from `OrgPeopleCommitteeMembersService` so both the
// Committee tab and the Board tab reuse the same foundation-name enrichment + camelCase mapping
// with zero duplication. Behavior is byte-identical to the original private methods; the committee
// read/reassign responses are unchanged.

import { PUBLIC_PROJECT_NAME_CACHE_MAX_ENTRIES, PUBLIC_PROJECT_NAME_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment, CommitteeMemberPerson, CommitteeServiceOrgSeat, FoundationNameEnrichment } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { resolveSeatAvatar } from '../helpers/avatar.helper';
import { logger } from './logger.service';
import { ProjectService } from './project.service';

/**
 * Per-pod uid → name cache for PUBLIC projects only. A public project's name is visible to every
 * caller, so sharing it across users leaks nothing; a private project's name is never stored here and
 * is fetched with the caller's own token on every request, as before. Bounded like
 * `FormationService.userMetadataCache`: each fetch that stores names first drops expired entries,
 * then each write evicts the oldest live one once `PUBLIC_PROJECT_NAME_CACHE_MAX_ENTRIES` is reached
 * (Map preserves insertion order).
 */
const publicProjectNameCache = new Map<string, { name: string; expiresAt: number }>();

/** Test-only: clears the module-level public-name cache so one spec's entries don't answer the next. */
export function resetPublicProjectNameCacheForTests(): void {
  publicProjectNameCache.clear();
}

function evictExpiredPublicProjectNames(now: number): void {
  for (const [key, entry] of publicProjectNameCache) {
    if (entry.expiresAt <= now) {
      publicProjectNameCache.delete(key);
    }
  }
}

function cachePublicProjectName(uid: string, name: string, now: number): void {
  publicProjectNameCache.delete(uid);
  if (publicProjectNameCache.size >= PUBLIC_PROJECT_NAME_CACHE_MAX_ENTRIES) {
    const oldest = publicProjectNameCache.keys().next();
    if (!oldest.done) {
      publicProjectNameCache.delete(oldest.value);
    }
  }
  publicProjectNameCache.set(uid, { name, expiresAt: now + PUBLIC_PROJECT_NAME_CACHE_TTL_MS });
}

/**
 * D-003 foundation-name enrichment: distinct `project_uid`s → names. Cached public names are served
 * from the per-pod cache; only the remaining uids go to `ProjectService.getProjectsByIds` (chunks
 * 100/req, FGA-aware). Fail-soft: a fetch error leaves those uids unnamed, so each seat falls back
 * to its `project_slug`.
 */
export async function enrichFoundationNames(req: Request, seats: CommitteeServiceOrgSeat[], projectService: ProjectService): Promise<FoundationNameEnrichment> {
  const uids = [...new Set(seats.map((s) => s.project_uid).filter((u): u is string => !!u))];
  const names = new Map<string, string>();
  const now = Date.now();
  const missing: string[] = [];
  for (const uid of uids) {
    const cached = publicProjectNameCache.get(uid);
    if (cached && now < cached.expiresAt) {
      names.set(uid, cached.name);
    } else {
      missing.push(uid);
    }
  }
  const cachedHits = names.size;
  if (missing.length === 0) {
    return { names, cachedHits, fetched: 0 };
  }

  try {
    const byUid = await projectService.getProjectsByIds(req, missing);
    const fetchedAt = Date.now();
    evictExpiredPublicProjectNames(fetchedAt);
    for (const [uid, project] of byUid) {
      if (!project?.name) {
        continue;
      }
      names.set(uid, project.name);
      if (project.public === true) {
        cachePublicProjectName(uid, project.name, fetchedAt);
      }
    }
  } catch (error) {
    logger.warning(req, 'enrich_foundation_names', 'project-name enrichment failed; falling back to project_slug', {
      uid_count: missing.length,
      err: error,
    });
  }
  return { names, cachedHits, fetched: missing.length };
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
    username: s.username?.trim() ? s.username.trim() : null,
    avatarUrl: resolveSeatAvatar(s),
  };
}
