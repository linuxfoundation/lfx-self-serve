// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Shared seat→assignment mapper extracted from `OrgPeopleCommitteeMembersService` so both the
// Committee tab and the Board tab reuse the same foundation-name enrichment + camelCase mapping
// with zero duplication.

import { PROJECT_VISIBILITY_DIRECT_READ_CAP, PUBLIC_PROJECT_NAME_CACHE_MAX_ENTRIES, PUBLIC_PROJECT_NAME_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import type { CommitteeMemberAssignment, CommitteeMemberPerson, CommitteeServiceOrgSeat, FoundationNameEnrichment } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { resolveSeatAvatar } from '../helpers/avatar.helper';
import { logger } from './logger.service';
import { ProjectService } from './project.service';

/**
 * Per-pod uid → name cache for PUBLIC projects only. `public` is the project's own flag
 * (`ProjectBase.IndexingConfig` in lfx-v2-project-service `internal/domain/models/project.go`), which
 * lfx-v2-fga-sync `handler.go` turns into a `user:*` viewer tuple — so a public project's name is
 * readable by every caller, and sharing it across users leaks nothing. A private project's name is
 * never stored here; it is fetched with the caller's own token on every request, as before.
 *
 * Staleness window: a project that flips from public to private keeps serving its cached name on
 * this pod for at most `PUBLIC_PROJECT_NAME_CACHE_TTL_MS` (5 min) after it was last fetched as
 * public; the per-user seat and directory caches downstream (30 s) can add at most 30 s. The exposure
 * is limited to the NAME: the caller already receives that seat's project slug and committee name
 * through their own authorized seat roster. Groups does not read visibility from this cache: its
 * org-shared aggregate (`ORG_LENS_GROUPS_TTL_SECONDS`, 15 min) is filled with `freshVisibility`, so it
 * holds only names confirmed public at fill time. A flip after the fill can still show there until
 * the aggregate expires.
 *
 * Bounded like `FormationService.userMetadataCache`: each successful fetch first drops expired
 * entries; each write evicts the oldest entry once `PUBLIC_PROJECT_NAME_CACHE_MAX_ENTRIES` is reached
 * (Map preserves insertion order). Concurrent cold misses for the same uid are not coalesced — each
 * fetches it once, which is bounded and accepted.
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

/** Options for `enrichFoundationNames`. */
export interface EnrichFoundationNamesOptions {
  /**
   * Confirm visibility with this lookup rather than the public-name cache: every uid goes to
   * `getProjectsByIds`, and uids it did not return get a direct project read (at most
   * `PROJECT_VISIBILITY_DIRECT_READ_CAP`, in parallel). For results shared across callers
   * (the Groups aggregate), which outlive the cache's staleness window.
   */
  freshVisibility?: boolean;
}

/**
 * D-003 foundation-name enrichment: distinct `project_uid`s → names. Cached public names are served
 * from the per-pod cache; only the remaining uids go to `ProjectService.getProjectsByIds` (chunks
 * 100/req, FGA-aware). Uids left unnamed fall back to their `project_slug` in `toAssignment`.
 *
 * `names` holds every name the caller may read, private ones included — right for a per-caller
 * response. `publicUids` marks which of them (and which nameless uids) are confirmed public, for a
 * result shared across callers: only those names are safe to store there. A shared result must also
 * pass `freshVisibility`, so a cache entry up to 5 min old cannot vouch for a project that has since
 * turned private.
 *
 * `getProjectsByIds` swallows per-batch failures (each failed batch contributes no projects), so a
 * query-service outage does not reject here — it shows up as `resolved` far below `requested`.
 */
export async function enrichFoundationNames(
  req: Request,
  seats: CommitteeServiceOrgSeat[],
  projectService: ProjectService,
  options: EnrichFoundationNamesOptions = {}
): Promise<FoundationNameEnrichment> {
  const uids = [...new Set(seats.map((s) => s.project_uid).filter((u): u is string => !!u))];
  const names = new Map<string, string>();
  const publicUids = new Set<string>();
  const privateUids = new Set<string>();
  const now = Date.now();
  const missing: string[] = [];
  for (const uid of uids) {
    const cached = options.freshVisibility ? undefined : publicProjectNameCache.get(uid);
    if (cached && now < cached.expiresAt) {
      names.set(uid, cached.name);
      publicUids.add(uid);
    } else {
      missing.push(uid);
    }
  }
  const cachedHits = names.size;
  if (missing.length === 0) {
    return { names, publicUids, privateUids, cachedHits, requested: 0, resolved: 0, confirmedByDirectRead: 0 };
  }

  let confirmedByDirectRead = 0;
  try {
    const byUid = await projectService.getProjectsByIds(req, missing);
    const fetchedAt = Date.now();
    evictExpiredPublicProjectNames(fetchedAt);
    for (const [uid, project] of byUid) {
      if (project?.public === true) {
        publicUids.add(uid);
      } else {
        privateUids.add(uid);
      }
      if (!project?.name) {
        continue;
      }
      names.set(uid, project.name);
      if (project.public === true) {
        cachePublicProjectName(uid, project.name, fetchedAt);
      }
    }
    const notIndexed = missing.filter((uid) => !byUid.has(uid));
    if (options.freshVisibility && notIndexed.length > 0) {
      // getProjectsByIds swallows batch failures, so an empty answer for several uids is far more
      // likely an index outage than several unindexed projects; don't turn it into a burst of
      // direct reads. Names stay withheld either way (fail closed).
      if (byUid.size === 0 && missing.length > 1) {
        logger.warning(req, 'enrich_foundation_names', 'Project index returned no projects; skipping direct reads (slug only)', {
          uid_count: missing.length,
        });
      } else {
        confirmedByDirectRead = await confirmPublicByDirectRead(req, notIndexed, projectService, names, publicUids, privateUids);
      }
    }
  } catch (error) {
    logger.warning(req, 'enrich_foundation_names', 'project-name enrichment failed; falling back to project_slug', {
      uid_count: missing.length,
      err: error,
    });
  }
  return { names, publicUids, privateUids, cachedHits, requested: missing.length, resolved: names.size - cachedHits, confirmedByDirectRead };
}

/**
 * Reads projects the project index did not return straight from project-service, under the caller's
 * token: `public: true` marks the uid public (with its name, when set), any other answer marks it
 * private. A failed or forbidden read leaves the uid unknown. Reads at most
 * `PROJECT_VISIBILITY_DIRECT_READ_CAP` uids, in parallel; returns how many it confirmed public.
 */
async function confirmPublicByDirectRead(
  req: Request,
  uids: string[],
  projectService: ProjectService,
  names: Map<string, string>,
  publicUids: Set<string>,
  privateUids: Set<string>
): Promise<number> {
  if (uids.length > PROJECT_VISIBILITY_DIRECT_READ_CAP) {
    logger.warning(req, 'enrich_foundation_names', 'Direct project-read cap reached; the remaining projects stay unconfirmed (slug only)', {
      missing_from_project_index: uids.length,
      direct_read_cap: PROJECT_VISIBILITY_DIRECT_READ_CAP,
    });
  }
  const toRead = uids.slice(0, PROJECT_VISIBILITY_DIRECT_READ_CAP);
  const reads = await Promise.allSettled(toRead.map((uid) => projectService.getProjectById(req, uid, false)));
  let confirmed = 0;
  reads.forEach((read, i) => {
    if (read.status !== 'fulfilled' || !read.value) {
      return;
    }
    const uid = toRead[i];
    if (read.value.public !== true) {
      privateUids.add(uid);
      return;
    }
    publicUids.add(uid);
    confirmed++;
    if (read.value.name) {
      names.set(uid, read.value.name);
    }
  });
  return confirmed;
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
