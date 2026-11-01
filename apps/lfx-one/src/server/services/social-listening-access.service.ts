// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SOCIAL_LISTENING_GROUP_ACCESS_CACHE_SWEEP_THRESHOLD, SOCIAL_LISTENING_GROUP_ACCESS_CACHE_TTL_MS } from '@lfx-one/shared/constants';
import type { SocialListeningAccessResponse } from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { getDashboardAccessReason } from '../helpers/dashboard-access.helper';
import { isValidFoundationSlug } from '../helpers/social-listening-params.helper';
import { getUsernameFromAuth } from '../utils/auth-helper';
import { personaDetectionService } from '../utils/persona-helper';
import { singleFlight } from '../utils/single-flight';
import { CommitteeService } from './committee.service';
import { logger } from './logger.service';
import { ProjectService } from './project.service';

/**
 * Who can view Social Listening for a foundation (lfx-self-serve-ops#387): the executive-dashboard
 * audience (EDs of that foundation, including root-writer EDs, and LF Staff), plus members of any of the
 * foundation's own groups that has `members_can_view_social_listening` on.
 *
 * The group-member answer is remembered per user and foundation for {@link SOCIAL_LISTENING_GROUP_ACCESS_CACHE_TTL_MS},
 * and concurrent lookups are coalesced — the page fires ~15 gated requests at once. Only definite
 * answers are cached; a failed lookup denies and is retried on the next request.
 */
export class SocialListeningAccessService {
  private readonly committeeService = new CommitteeService();
  private readonly projectService = new ProjectService();
  private readonly groupAccessCache = new Map<string, { canView: boolean; expiresAt: number }>();

  public async getAccess(req: Request, foundationSlug: string): Promise<SocialListeningAccessResponse> {
    const personas = await personaDetectionService.getPersonas(req);
    const dashboardReason = await getDashboardAccessReason(req, personas, foundationSlug);
    if (dashboardReason !== 'none') {
      return { canView: true, reason: dashboardReason };
    }

    if (!foundationSlug || !isValidFoundationSlug(foundationSlug)) {
      return { canView: false, reason: 'none' };
    }

    const canView = await this.canGroupMemberView(req, foundationSlug);
    return canView ? { canView: true, reason: 'group-member' } : { canView: false, reason: 'none' };
  }

  private async canGroupMemberView(req: Request, foundationSlug: string): Promise<boolean> {
    const username = await getUsernameFromAuth(req);
    if (!username) {
      return false;
    }

    // Slugs are stored verbatim upstream, so look up as given; only the cache key is case-folded.
    const cacheKey = `${username}:${foundationSlug.toLowerCase()}`;
    const cached = this.groupAccessCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.canView;
    }

    return singleFlight(`social-listening-group-access:${cacheKey}`, async () => {
      try {
        // getProjectIdBySlug also answers `exists: false` when the NATS lookup itself fails, so an
        // unresolved slug denies without being remembered — a transient blip must not lock a member out.
        const project = await this.projectService.getProjectIdBySlug(req, foundationSlug);
        if (!project.exists) {
          return false;
        }
        // foundationSlug is caller-supplied: only a foundation's own groups grant access, so a child
        // project's opted-in group must not pass by naming the child's slug.
        const isFoundation = computeIsFoundation(await this.projectService.getProjectById(req, project.uid, false));
        const canView = isFoundation && (await this.committeeService.canGroupMemberViewSocialListening(req, project.uid));
        this.remember(cacheKey, canView);
        return canView;
      } catch (error) {
        logger.warning(req, 'social_listening_group_access', 'Group access lookup failed, denying', {
          err: error,
          foundation_slug: foundationSlug,
        });
        return false;
      }
    });
  }

  private remember(cacheKey: string, canView: boolean): void {
    const now = Date.now();
    if (this.groupAccessCache.size >= SOCIAL_LISTENING_GROUP_ACCESS_CACHE_SWEEP_THRESHOLD) {
      for (const [key, entry] of this.groupAccessCache) {
        if (entry.expiresAt <= now) {
          this.groupAccessCache.delete(key);
        }
      }
      // Still full of live entries: evict the oldest (Map iterates in insertion order) so the cache stays bounded.
      const oldest = this.groupAccessCache.keys().next();
      if (this.groupAccessCache.size >= SOCIAL_LISTENING_GROUP_ACCESS_CACHE_SWEEP_THRESHOLD && !oldest.done) {
        this.groupAccessCache.delete(oldest.value);
      }
    }
    this.groupAccessCache.set(cacheKey, { canView, expiresAt: now + SOCIAL_LISTENING_GROUP_ACCESS_CACHE_TTL_MS });
  }
}

export const socialListeningAccessService = new SocialListeningAccessService();
