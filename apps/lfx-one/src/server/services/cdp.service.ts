// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CDP_CONFIG } from '@lfx-one/shared/constants';
import {
  CdpCreateIdentityRequest,
  CdpIdentity,
  CdpIdentityRaw,
  CdpOrganization,
  CdpProjectAffiliation,
  CdpResolveResponse,
  CdpWorkExperience,
  CdpWorkExperienceRequest,
  ProjectAffiliationPatchBody,
  WorkExperienceEntry,
} from '@lfx-one/shared/interfaces';
import { randomUUID } from 'crypto';
import { Request } from 'express';

import { CDP_PLATFORM_ICONS } from '@lfx-one/shared/constants';
import { MicroserviceError } from '../errors';
import { logger } from './logger.service';

/**
 * CDP PATCH affiliation entry format.
 * CDP expects dateStart/dateEnd instead of startDate/endDate.
 */
interface CdpProjectAffiliationPatchEntry {
  id?: string;
  organizationId: string;
  source: string;
  dateStart: string;
  dateEnd: string | null;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Service for interacting with the CDP (Community Data Platform) API
 * Uses PCC Auth0 client credentials with CDP audience for authentication
 */
export class CdpService {
  private cachedToken: CachedToken | null = null;

  private readonly cdpApiUrl: string;
  private readonly issuerBaseUrl: string;
  private readonly audience: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  public constructor() {
    this.cdpApiUrl = (process.env['CDP_API_URL'] || CDP_CONFIG.DEFAULT_STAGING_URL).replace(/\/+$/, '');
    this.issuerBaseUrl = (process.env['PCC_AUTH0_ISSUER_BASE_URL'] || '').replace(/\/+$/, '');
    this.audience = process.env['CDP_AUDIENCE'] || '';
    this.clientId = process.env['PCC_AUTH0_CLIENT_ID'] || '';
    this.clientSecret = process.env['PCC_AUTH0_CLIENT_SECRET'] || '';
  }

  /**
   * Get a valid CDP access token using PCC client credentials with CDP audience
   */
  public async generateToken(req: Request | undefined): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      logger.debug(req, 'generate_cdp_token', 'Using cached CDP token');
      return this.cachedToken.token;
    }

    const startTime = logger.startOperation(req, 'generate_cdp_token');

    const tokenUrl = `${this.issuerBaseUrl}/oauth/token`;

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          audience: this.audience,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new MicroserviceError(`CDP token request failed: ${response.statusText}`, response.status, 'CDP_TOKEN_ERROR', {
          operation: 'generate_cdp_token',
          service: 'cdp_service',
          errorBody: errorText,
        });
      }

      const data = (await response.json()) as { access_token: string; expires_in: number };

      // Cache with 5-minute buffer before expiry
      this.cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 300) * 1000,
      };

      logger.success(req, 'generate_cdp_token', startTime, {
        expires_in: data.expires_in,
      });

      return data.access_token;
    } catch (error) {
      if (error instanceof MicroserviceError) {
        throw error;
      }
      logger.error(req, 'generate_cdp_token', startTime, error);
      throw new MicroserviceError('Failed to obtain CDP access token', 502, 'CDP_TOKEN_ERROR', {
        operation: 'generate_cdp_token',
        service: 'cdp_service',
      });
    }
  }

  /**
   * Resolve an LFID to a CDP member ID
   */
  public async resolveMember(req: Request | undefined, lfids: string[], emails?: string[]): Promise<string> {
    const token = await this.generateToken(req);
    const resolveUrl = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.RESOLVE_MEMBER}`;
    const requestId = randomUUID();

    logger.debug(req, 'resolve_cdp_member', 'Resolving CDP member', { lfids, request_id: requestId });

    const body: { lfids: string[]; emails?: string[] } = { lfids };
    if (emails?.length) {
      body.emails = emails;
    }

    const response = await fetch(resolveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP member resolve failed: ${response.statusText}`, response.status, 'CDP_RESOLVE_ERROR', {
        operation: 'resolve_cdp_member',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }

    const data = (await response.json()) as CdpResolveResponse;
    return data.memberId;
  }

  /**
   * Get identities for a CDP member
   */
  public async getMemberIdentities(req: Request | undefined, memberId: string): Promise<CdpIdentityRaw[]> {
    const token = await this.generateToken(req);
    const identitiesUrl = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_IDENTITIES(memberId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'get_cdp_identities', 'Fetching CDP member identities', { member_id: memberId, request_id: requestId });

    const response = await fetch(identitiesUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP identities request failed: ${response.statusText}`, response.status, 'CDP_IDENTITIES_ERROR', {
        operation: 'get_cdp_identities',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }

    const data = (await response.json()) as { identities: CdpIdentityRaw[] };
    return data.identities;
  }

  /**
   * Reject (mark as "not me") a specific CDP identity
   */
  public async rejectIdentity(req: Request | undefined, memberId: string, identityId: string, verifiedBy: string): Promise<void> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_IDENTITIES(memberId)}/${encodeURIComponent(identityId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'reject_cdp_identity', 'Rejecting CDP identity', { member_id: memberId, identity_id: identityId });

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      body: JSON.stringify({ verified: false, verifiedBy }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP identity reject failed: ${response.statusText}`, response.status, 'CDP_IDENTITY_REJECT_ERROR', {
        operation: 'reject_cdp_identity',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }
  }

  /**
   * Reject an identity for a user by resolving their member ID first
   */
  public async rejectIdentityForUser(req: Request | undefined, sub: string, identityId: string): Promise<void> {
    const memberId = await this.resolveMember(req, [sub]);
    await this.rejectIdentity(req, memberId, identityId, sub);
  }

  /**
   * Verify (mark as confirmed) a specific CDP identity
   */
  public async verifyIdentity(req: Request | undefined, memberId: string, identityId: string, verifiedBy = 'lfxOne'): Promise<void> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_IDENTITIES(memberId)}/${encodeURIComponent(identityId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'verify_cdp_identity', 'Verifying CDP identity', { member_id: memberId, identity_id: identityId, verified_by: verifiedBy });

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      body: JSON.stringify({ verified: true, verifiedBy }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP identity verify failed: ${response.statusText}`, response.status, 'CDP_IDENTITY_VERIFY_ERROR', {
        operation: 'verify_cdp_identity',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }
  }

  /**
   * Verify an identity for a user by resolving their member ID first
   */
  public async verifyIdentityForUser(req: Request | undefined, sub: string, identityId: string, verifiedBy = 'lfxOne'): Promise<void> {
    const memberId = await this.resolveMember(req, [sub]);
    await this.verifyIdentity(req, memberId, identityId, verifiedBy);
  }

  /**
   * Create a new identity for a CDP member
   */
  public async createIdentity(req: Request | undefined, memberId: string, body: CdpCreateIdentityRequest): Promise<void> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_IDENTITIES(memberId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'create_cdp_identity', 'Creating CDP identity', {
      member_id: memberId,
      platform: body.platform,
      value: body.value,
      request_id: requestId,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP identity create failed: ${response.statusText}`, response.status, 'CDP_IDENTITY_CREATE_ERROR', {
        operation: 'create_cdp_identity',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }
  }

  /**
   * Create an identity for a user by resolving their member ID first
   */
  public async createIdentityForUser(req: Request | undefined, lfids: string[], body: CdpCreateIdentityRequest): Promise<void> {
    const memberId = await this.resolveMember(req, lfids);
    await this.createIdentity(req, memberId, body);
  }

  /**
   * Orchestrates the full flow: token → resolve → get identities
   * Maps raw CDP identities to frontend-ready CdpIdentity format
   */
  public async getIdentitiesForUser(req: Request | undefined, sub: string, email?: string): Promise<CdpIdentity[]> {
    const startTime = logger.startOperation(req, 'get_cdp_identities_for_user', { sub });

    try {
      const emails = email ? [email] : undefined;
      const memberId = await this.resolveMember(req, [sub], emails);

      logger.debug(req, 'get_cdp_identities_for_user', 'Resolved CDP member', { member_id: memberId });

      const rawIdentities = await this.getMemberIdentities(req, memberId);

      const identities: CdpIdentity[] = rawIdentities.map((raw) => {
        const platform = raw.platform === 'custom' ? 'email' : raw.platform;
        return {
          id: raw.id,
          platform,
          value: raw.value,
          verified: raw.verified,
          verifiedBy: raw.verifiedBy ?? null,
          source: raw.source,
          icon: CDP_PLATFORM_ICONS[platform] || 'fa-light fa-globe',
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        };
      });

      logger.success(req, 'get_cdp_identities_for_user', startTime, {
        sub,
        member_id: memberId,
        identity_count: identities.length,
      });

      return identities;
    } catch (error) {
      // Return empty array on 404 (user has no CDP profile)
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        logger.warning(req, 'get_cdp_identities_for_user', 'No CDP profile found for user', { sub });
        return [];
      }

      logger.error(req, 'get_cdp_identities_for_user', startTime, error, { sub });
      throw error;
    }
  }

  /**
   * Get work experiences for a CDP member
   */
  public async getMemberWorkExperiences(req: Request | undefined, memberId: string): Promise<CdpWorkExperience[]> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_WORK_EXPERIENCES(memberId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'get_cdp_work_experiences', 'Fetching CDP member work experiences', { member_id: memberId, request_id: requestId });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP work experiences request failed: ${response.statusText}`, response.status, 'CDP_WORK_EXPERIENCES_ERROR', {
        operation: 'get_cdp_work_experiences',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }

    const data = (await response.json()) as { workExperiences: CdpWorkExperience[] };
    return data.workExperiences;
  }

  /**
   * Orchestrates the full flow: token → resolve → get work experiences
   * Maps raw CDP work experiences to frontend-ready WorkExperienceEntry format
   */
  public async getWorkExperiencesForUser(req: Request | undefined, sub: string): Promise<WorkExperienceEntry[]> {
    const startTime = logger.startOperation(req, 'get_cdp_work_experiences_for_user', { sub });

    try {
      const memberId = await this.resolveMember(req, [sub]);

      logger.debug(req, 'get_cdp_work_experiences_for_user', 'Resolved CDP member', { member_id: memberId });

      const rawExperiences = await this.getMemberWorkExperiences(req, memberId);

      const entries: WorkExperienceEntry[] = rawExperiences.map((raw) => ({
        id: raw.id,
        organization: raw.organizationName,
        organizationId: raw.organizationId,
        organizationLogo: raw.organizationLogo || undefined,
        jobTitle: raw.jobTitle,
        startDate: this.formatDateToMonthYear(raw.startDate),
        endDate: raw.endDate ? this.formatDateToMonthYear(raw.endDate) : undefined,
        source: raw.source === 'lfxOne' || raw.source === 'ui' ? ('manual' as const) : ('cdp-enriched' as const),
        cdpSource: raw.source,
        needsReview: !(raw.verified && raw.verifiedBy === sub),
      }));

      logger.success(req, 'get_cdp_work_experiences_for_user', startTime, {
        sub,
        member_id: memberId,
        work_experience_count: entries.length,
      });

      return entries;
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        logger.warning(req, 'get_cdp_work_experiences_for_user', 'No CDP profile found for user', { sub });
        return [];
      }

      logger.error(req, 'get_cdp_work_experiences_for_user', startTime, error, { sub });
      throw error;
    }
  }

  /**
   * Confirm (verify) a specific CDP work experience
   */
  public async confirmWorkExperience(req: Request | undefined, memberId: string, workExperienceId: string, verifiedBy: string): Promise<void> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_WORK_EXPERIENCES(memberId)}/${encodeURIComponent(workExperienceId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'confirm_cdp_work_experience', 'Confirming CDP work experience', {
      member_id: memberId,
      work_experience_id: workExperienceId,
      verified_by: verifiedBy,
    });

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      body: JSON.stringify({ verified: true, verifiedBy }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP work experience confirm failed: ${response.statusText}`, response.status, 'CDP_WORK_EXPERIENCE_CONFIRM_ERROR', {
        operation: 'confirm_cdp_work_experience',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }
  }

  /**
   * Confirm a work experience for a user by resolving their member ID first
   */
  public async confirmWorkExperienceForUser(req: Request | undefined, sub: string, workExperienceId: string): Promise<void> {
    const memberId = await this.resolveMember(req, [sub]);
    await this.confirmWorkExperience(req, memberId, workExperienceId, sub);
  }

  /**
   * Delete a specific CDP work experience
   */
  public async deleteWorkExperience(req: Request | undefined, memberId: string, workExperienceId: string): Promise<void> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_WORK_EXPERIENCES(memberId)}/${encodeURIComponent(workExperienceId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'delete_cdp_work_experience', 'Deleting CDP work experience', {
      member_id: memberId,
      work_experience_id: workExperienceId,
    });

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP work experience delete failed: ${response.statusText}`, response.status, 'CDP_WORK_EXPERIENCE_DELETE_ERROR', {
        operation: 'delete_cdp_work_experience',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }
  }

  /**
   * Delete a work experience for a user by resolving their member ID first
   */
  public async deleteWorkExperienceForUser(req: Request | undefined, sub: string, workExperienceId: string): Promise<void> {
    const memberId = await this.resolveMember(req, [sub]);
    await this.deleteWorkExperience(req, memberId, workExperienceId);
  }

  /**
   * Update an existing CDP work experience
   */
  public async updateWorkExperience(req: Request | undefined, memberId: string, workExperienceId: string, body: CdpWorkExperienceRequest): Promise<void> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_WORK_EXPERIENCES(memberId)}/${encodeURIComponent(workExperienceId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'update_cdp_work_experience', 'Updating CDP work experience', {
      member_id: memberId,
      work_experience_id: workExperienceId,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP work experience update failed: ${response.statusText}`, response.status, 'CDP_WORK_EXPERIENCE_UPDATE_ERROR', {
        operation: 'update_cdp_work_experience',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }
  }

  /**
   * Update a work experience for a user by resolving their member ID first
   */
  public async updateWorkExperienceForUser(req: Request | undefined, sub: string, workExperienceId: string, body: CdpWorkExperienceRequest): Promise<void> {
    const memberId = await this.resolveMember(req, [sub]);
    await this.updateWorkExperience(req, memberId, workExperienceId, body);
  }

  /**
   * Create a new CDP work experience
   */
  public async createWorkExperience(req: Request | undefined, memberId: string, body: CdpWorkExperienceRequest): Promise<void> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_WORK_EXPERIENCES(memberId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'create_cdp_work_experience', 'Creating CDP work experience', {
      member_id: memberId,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP work experience create failed: ${response.statusText}`, response.status, 'CDP_WORK_EXPERIENCE_CREATE_ERROR', {
        operation: 'create_cdp_work_experience',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }
  }

  /**
   * Create a work experience for a user by resolving their member ID first
   */
  public async createWorkExperienceForUser(req: Request | undefined, sub: string, body: CdpWorkExperienceRequest): Promise<void> {
    const memberId = await this.resolveMember(req, [sub]);
    await this.createWorkExperience(req, memberId, body);
  }

  /**
   * Get project affiliations for a CDP member
   */
  public async getMemberProjectAffiliations(req: Request | undefined, memberId: string): Promise<CdpProjectAffiliation[]> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_PROJECT_AFFILIATIONS(memberId)}`;
    const requestId = randomUUID();

    logger.debug(req, 'get_cdp_project_affiliations', 'Fetching CDP member project affiliations', { member_id: memberId, request_id: requestId });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP project affiliations request failed: ${response.statusText}`, response.status, 'CDP_PROJECT_AFFILIATIONS_ERROR', {
        operation: 'get_cdp_project_affiliations',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }

    const data = (await response.json()) as { projectAffiliations: CdpProjectAffiliation[] };
    return data.projectAffiliations;
  }

  /**
   * Orchestrates the full flow: token → resolve → get project affiliations
   */
  public async getProjectAffiliationsForUser(req: Request | undefined, sub: string): Promise<CdpProjectAffiliation[]> {
    const startTime = logger.startOperation(req, 'get_cdp_project_affiliations_for_user', { sub });

    try {
      const memberId = await this.resolveMember(req, [sub]);

      logger.debug(req, 'get_cdp_project_affiliations_for_user', 'Resolved CDP member', { member_id: memberId });

      const affiliations = await this.getMemberProjectAffiliations(req, memberId);

      logger.success(req, 'get_cdp_project_affiliations_for_user', startTime, {
        sub,
        member_id: memberId,
        affiliation_count: affiliations.length,
      });

      return affiliations;
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        logger.warning(req, 'get_cdp_project_affiliations_for_user', 'No CDP profile found for user', { sub });
        return [];
      }

      logger.error(req, 'get_cdp_project_affiliations_for_user', startTime, error, { sub });
      throw error;
    }
  }

  /**
   * PATCH project affiliations for a CDP member's specific project
   */
  public async patchProjectAffiliation(req: Request | undefined, memberId: string, projectId: string, body: ProjectAffiliationPatchBody): Promise<void> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.MEMBER_PROJECT_AFFILIATION(memberId, projectId)}`;
    const requestId = randomUUID();

    const cdpBody = {
      id: body.id,
      projectSlug: body.projectSlug,
      verified: body.verified,
      verifiedBy: body.verifiedBy,
      affiliations: this.mapAffiliationsToCdpFormat(body.affiliations),
    };

    logger.debug(req, 'patch_cdp_project_affiliation', 'Patching CDP project affiliation', {
      member_id: memberId,
      project_id: projectId,
      affiliation_count: body.affiliations.length,
    });

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      body: JSON.stringify(cdpBody),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP project affiliation patch failed: ${response.statusText}`, response.status, 'CDP_PROJECT_AFFILIATION_PATCH_ERROR', {
        operation: 'patch_cdp_project_affiliation',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }
  }

  /**
   * PATCH project affiliations for a user by resolving their member ID first
   */
  public async patchProjectAffiliationForUser(req: Request | undefined, sub: string, projectId: string, body: ProjectAffiliationPatchBody): Promise<void> {
    const memberId = await this.resolveMember(req, [sub]);
    await this.patchProjectAffiliation(req, memberId, projectId, body);
  }

  /**
   * Find an organization in CDP by domain
   */
  public async findOrganizationByDomain(req: Request | undefined, domain: string): Promise<CdpOrganization | null> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.ORGANIZATIONS}?domain=${encodeURIComponent(domain)}`;
    const requestId = randomUUID();

    logger.debug(req, 'find_cdp_organization', 'Finding CDP organization by domain', { domain, request_id: requestId });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.debug(req, 'find_cdp_organization', 'Organization not found in CDP', { domain });
        return null;
      }
      const errorText = await response.text();
      throw new MicroserviceError(`CDP organization find failed: ${response.statusText}`, response.status, 'CDP_ORGANIZATION_FIND_ERROR', {
        operation: 'find_cdp_organization',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }

    const data = (await response.json()) as CdpOrganization;
    if (!data?.id) {
      return null;
    }
    return data;
  }

  /**
   * Create an organization in CDP
   */
  public async createOrganization(req: Request | undefined, name: string, domain: string, source = 'lfxOne'): Promise<CdpOrganization> {
    const token = await this.generateToken(req);
    const url = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.ORGANIZATIONS}`;
    const requestId = randomUUID();

    logger.debug(req, 'create_cdp_organization', 'Creating CDP organization', { name, domain, request_id: requestId });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-LFX-Request-ID': requestId,
      },
      body: JSON.stringify({ name, domain, source }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new MicroserviceError(`CDP organization create failed: ${response.statusText}`, response.status, 'CDP_ORGANIZATION_CREATE_ERROR', {
        operation: 'create_cdp_organization',
        service: 'cdp_service',
        errorBody: errorText,
      });
    }

    return (await response.json()) as CdpOrganization;
  }

  /**
   * Find or create an organization in CDP by domain
   * Tries to find first, creates if not found
   */
  public async resolveOrganization(req: Request | undefined, name: string, domain: string): Promise<CdpOrganization> {
    logger.debug(req, 'resolve_cdp_organization', 'Resolving CDP organization', { name, domain });

    if (domain) {
      const existing = await this.findOrganizationByDomain(req, domain);
      if (existing) {
        logger.debug(req, 'resolve_cdp_organization', 'Found existing CDP organization', { id: existing.id, name: existing.name });
        return existing;
      }
    }

    const created = await this.createOrganization(req, name, domain);
    logger.info(req, 'resolve_cdp_organization', 'Created new CDP organization', { id: created.id, name: created.name, domain });
    return created;
  }

  /**
   * Map our interface field names (startDate/endDate) to CDP PATCH field names (dateStart/dateEnd)
   */
  private mapAffiliationsToCdpFormat(affiliations: ProjectAffiliationPatchBody['affiliations']): CdpProjectAffiliationPatchEntry[] {
    return affiliations.map((aff) => ({
      ...(aff.id ? { id: aff.id } : {}),
      organizationId: aff.organizationId,
      source: aff.source,
      dateStart: aff.startDate,
      dateEnd: aff.endDate,
    }));
  }

  /**
   * Format an ISO 8601 date string to "MMM YYYY" format
   */
  private formatDateToMonthYear(isoDate: string): string {
    const date = new Date(isoDate);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }
}
