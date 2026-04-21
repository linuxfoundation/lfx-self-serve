// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AFFILIATED_PROJECT_UIDS_CACHE_TTL_MS,
  DETECTION_SOURCE_MAP,
  PERSONA_PRIORITY,
  PERSONAS_CACHE_TTL_MS,
  ROOT_PROJECT_SLUG,
  ROOT_PROJECT_UID_CACHE_TTL_MS,
} from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import {
  Account,
  AffiliatedProjectUidsCacheEntry,
  EnrichedPersonaProject,
  PersonaApiResponse,
  PersonaApiResponseCacheEntry,
  PersonaDetectionResponse,
  PersonaDetections,
  PersonaProject,
  PersonaType,
  VALID_PERSONAS,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { getEffectiveEmail, getEffectiveUsername } from '../utils/auth-helper';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { NatsService } from './nats.service';

/**
 * Detects user personas via NATS RPC. Returns raw detection data — consumers needing
 * project metadata (name, logo, foundation flag) must fetch those separately.
 */
export class PersonaDetectionService {
  private readonly natsService: NatsService;
  private readonly accessCheckService: AccessCheckService;

  // Per-user caches store in-flight Promises so concurrent callers share one NATS round-trip.
  private readonly affiliatedUidsCache = new Map<string, AffiliatedProjectUidsCacheEntry>();
  private readonly personasCache = new Map<string, PersonaApiResponseCacheEntry>();
  private readonly rootWriterRequestCache = new WeakMap<Request, Promise<boolean>>();
  private rootProjectUidCache: { uid: string | null; expiresAt: number } | null = null;

  public constructor() {
    this.natsService = new NatsService();
    this.accessCheckService = new AccessCheckService();

    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.affiliatedUidsCache) {
        if (now >= entry.expiresAt) {
          this.affiliatedUidsCache.delete(key);
        }
      }
      for (const [key, entry] of this.personasCache) {
        if (now >= entry.expiresAt) {
          this.personasCache.delete(key);
        }
      }
    }, 60_000).unref();
  }

  /** Returns project slugs the user is affiliated with. Empty on error — callers degrade gracefully. */
  public async getAffiliatedProjectSlugs(req: Request): Promise<string[]> {
    const username = getEffectiveUsername(req) || '';
    const email = getEffectiveEmail(req) || '';
    const cacheKey = username || email;

    // No stable identifier — bypass cache to prevent cross-user data leaks.
    if (!cacheKey) {
      return this.fetchAndResolveAffiliatedSlugs(req, username, email);
    }

    const cached = this.affiliatedUidsCache.get(cacheKey);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        return cached.promise;
      }
      this.affiliatedUidsCache.delete(cacheKey);
    }

    // Stored before await so concurrent callers share the fetch.
    const promise = this.fetchAndResolveAffiliatedSlugs(req, username, email);
    this.affiliatedUidsCache.set(cacheKey, { promise, expiresAt: Date.now() + AFFILIATED_PROJECT_UIDS_CACHE_TTL_MS });

    promise.catch(() => this.affiliatedUidsCache.delete(cacheKey));

    return promise;
  }

  public async getPersonas(req: Request): Promise<PersonaApiResponse> {
    const username = getEffectiveUsername(req) || '';
    const email = getEffectiveEmail(req) || '';
    const cacheKey = username || email;

    // isRootWriter is request-scoped (bearer-token dependent) — resolve per-request and merge.
    const [detections, isRootWriter] = await Promise.all([this.getPersonaDetections(req, username, email, cacheKey), this.checkRootWriter(req)]);

    // Compute the per-request persona list without mutating the cached detections object.
    let personas = detections.personas;
    if (isRootWriter) {
      personas = this.applyForcedPersona(personas, 'executive-director');
    }

    // Only honor the impersonation override when the target user actually has the forced persona.
    // Root-writer promotion above is the only path that may inject a persona the user doesn't natively hold.
    const forcedPersona = req.appSession?.['impersonationPersonaContext'];
    if (typeof forcedPersona === 'string' && VALID_PERSONAS.has(forcedPersona) && personas.includes(forcedPersona as PersonaType)) {
      personas = this.applyForcedPersona(personas, forcedPersona as PersonaType);
    }

    return { ...detections, personas, isRootWriter };
  }

  public async checkRootWriter(req: Request): Promise<boolean> {
    const cached = this.rootWriterRequestCache.get(req);
    if (cached) return cached;

    // Degrade to false on failure so transient access-check errors don't 500 callers that rely on this as a bypass hint.
    const promise = this.resolveRootUid(req)
      .then((rootUid) => {
        if (!rootUid) return false;
        return this.accessCheckService.checkSingleAccess(req, { resource: 'project', id: rootUid, access: 'writer' });
      })
      .catch((error) => {
        logger.warning(req, 'check_root_writer', 'Root-writer check failed, assuming no bypass', { err: error });
        return false;
      });
    this.rootWriterRequestCache.set(req, promise);
    return promise;
  }

  private async getPersonaDetections(req: Request, username: string, email: string, cacheKey: string): Promise<PersonaDetections> {
    // No stable identifier — bypass cache to prevent cross-user data leaks.
    if (!cacheKey) {
      return this.computePersonaDetections(req, username, email);
    }

    const cached = this.personasCache.get(cacheKey);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        return cached.promise;
      }
      this.personasCache.delete(cacheKey);
    }

    // Stored before await so concurrent callers share the fetch.
    const promise = this.computePersonaDetections(req, username, email);
    this.personasCache.set(cacheKey, { promise, expiresAt: Date.now() + PERSONAS_CACHE_TTL_MS });

    // Evict failed lookups so the next caller retries instead of being pinned for the TTL.
    promise.then(
      (result) => {
        if (result.error) {
          this.personasCache.delete(cacheKey);
        }
      },
      () => this.personasCache.delete(cacheKey)
    );

    return promise;
  }

  private async resolveRootUid(req: Request): Promise<string | null> {
    if (this.rootProjectUidCache && Date.now() < this.rootProjectUidCache.expiresAt) {
      return this.rootProjectUidCache.uid;
    }

    try {
      const codec = this.natsService.getCodec();
      const response = await this.natsService.request(NatsSubjects.PROJECT_SLUG_TO_UID, codec.encode(ROOT_PROJECT_SLUG), { timeout: 5000 });
      const uid = codec.decode(response.data).trim();
      if (!uid) {
        // Don't cache empty responses — a transient glitch would disable bypass for ROOT_PROJECT_UID_CACHE_TTL_MS.
        logger.warning(req, 'resolve_root_uid', 'ROOT slug resolved to empty UID', { slug: ROOT_PROJECT_SLUG });
        return null;
      }
      this.rootProjectUidCache = { uid, expiresAt: Date.now() + ROOT_PROJECT_UID_CACHE_TTL_MS };
      return uid;
    } catch (error) {
      logger.warning(req, 'resolve_root_uid', 'ROOT slug→UID NATS lookup failed', { err: error, slug: ROOT_PROJECT_SLUG });
      return null;
    }
  }

  private async computePersonaDetections(req: Request, username: string, email: string): Promise<PersonaDetections> {
    logger.debug(req, 'get_personas', 'Fetching personas from detection service', {
      username,
      email: email ? '***' : 'empty',
    });

    const detectionResponse = await this.fetchPersonaDetections(req, username, email);

    if (detectionResponse.error) {
      logger.warning(req, 'get_personas', 'Persona detection returned error', {
        error_code: detectionResponse.error.code,
        error_message: detectionResponse.error.message,
      });

      return {
        personaProjects: {},
        personas: ['contributor'],
        projects: [],
        organizations: [],
        error: detectionResponse.error.message,
      };
    }

    if (detectionResponse.projects.length === 0) {
      logger.debug(req, 'get_personas', 'No persona detections found for user');

      return {
        personaProjects: {},
        personas: ['contributor'],
        projects: [],
        organizations: [],
        error: null,
      };
    }

    const projects = this.toEnrichedPersonaProjects(detectionResponse);

    const personaProjects = this.buildPersonaProjectsMap(projects);
    const personas = this.collectUniquePersonas(projects);

    logger.debug(req, 'get_personas', 'Persona detection complete', {
      project_count: projects.length,
      persona_count: personas.length,
      personas,
    });

    return {
      personaProjects,
      personas,
      projects,
      organizations: this.extractOrganizations(req, projects),
      error: null,
    };
  }

  private async fetchAndResolveAffiliatedSlugs(req: Request, username: string, email: string): Promise<string[]> {
    const detectionResponse = await this.fetchPersonaDetections(req, username, email);

    if (detectionResponse.error) {
      logger.warning(req, 'get_affiliated_project_slugs', 'Persona detection returned an error, returning empty affiliation list', {
        error_code: detectionResponse.error.code,
        error_message: detectionResponse.error.message,
      });
      return [];
    }

    const slugs = [...new Set(detectionResponse.projects.map((p) => p.project_slug?.toLowerCase()).filter(Boolean))];

    logger.debug(req, 'get_affiliated_project_slugs', 'Resolved affiliated project slugs', {
      slug_count: slugs.length,
      project_slugs: slugs,
    });

    return slugs;
  }

  private async fetchPersonaDetections(req: Request, username: string, email: string): Promise<PersonaDetectionResponse> {
    logger.debug(req, 'fetch_persona_detections', 'Sending NATS persona request', {
      subject: NatsSubjects.PERSONAS_GET,
      has_username: !!username,
      has_email: !!email,
      email: email ? '***' : 'empty',
    });

    try {
      const codec = this.natsService.getCodec();
      const payload = JSON.stringify({ username, email });
      const response = await this.natsService.request(NatsSubjects.PERSONAS_GET, codec.encode(payload), { timeout: 5000 });
      const decoded = codec.decode(response.data);

      logger.debug(req, 'fetch_persona_detections', 'Raw NATS persona response received', {
        response_length: decoded.length,
        raw_response: decoded.length <= 2000 ? decoded : decoded.slice(0, 2000) + '...[truncated]',
      });

      const parsed = JSON.parse(decoded);

      const projectCount = Array.isArray(parsed?.projects) ? parsed.projects.length : 0;
      const boardDetections = Array.isArray(parsed?.projects)
        ? parsed.projects.flatMap((p: Record<string, unknown>) =>
            Array.isArray(p['detections'])
              ? (p['detections'] as Record<string, unknown>[]).filter((d: Record<string, unknown>) => d['source'] === 'board_member')
              : []
          )
        : [];
      logger.debug(req, 'fetch_persona_detections', 'Raw NATS persona response', {
        project_count: projectCount,
        board_member_detections: boardDetections.length,
        board_member_has_org: boardDetections.map((d: Record<string, unknown>) => {
          const extra = d['extra'] as Record<string, unknown> | undefined;
          const org = extra?.['organization'] as Record<string, unknown> | undefined;
          return { has_org: !!org, org_id: org?.['id'], org_name: org?.['name'] };
        }),
      });

      // Normalize malformed fields to prevent downstream crashes.
      // ROOT is stripped here so every consumer (personaProjects map, personas, affiliated slugs,
      // organizations) sees a ROOT-free view. checkRootWriter uses an independent NATS lookup and
      // is unaffected.
      const normalized = {
        projects: Array.isArray(parsed?.projects)
          ? parsed.projects
              .map((p: Record<string, unknown>) => ({
                project_uid: p['project_uid'] || '',
                project_slug: p['project_slug'] || '',
                detections: Array.isArray(p['detections']) ? p['detections'] : [],
              }))
              .filter((p: { project_slug: string }) => p.project_slug !== ROOT_PROJECT_SLUG)
          : [],
        error: parsed?.error ?? null,
      } as PersonaDetectionResponse;

      logger.debug(req, 'fetch_persona_detections', 'Persona detection normalized', {
        project_count: normalized.projects.length,
        project_uids: normalized.projects.map((p) => p.project_uid),
        has_error: !!normalized.error,
        error_code: normalized.error?.code ?? null,
      });

      return normalized;
    } catch (error) {
      logger.warning(req, 'fetch_persona_detections', 'NATS persona detection failed', { err: error });

      return { projects: [], error: { code: 'nats_error', message: 'Failed to fetch persona detections' } };
    }
  }

  // Metadata fields (name, logo, parent, description) are left null — consumers fetch separately.
  private toEnrichedPersonaProjects(response: PersonaDetectionResponse): EnrichedPersonaProject[] {
    return response.projects.map((project) => ({
      projectUid: project.project_uid,
      projectSlug: project.project_slug,
      projectName: null,
      parentProjectUid: null,
      isFoundation: false,
      logoUrl: null,
      description: null,
      detections: project.detections,
      personas: this.mapDetectionsToPersonas(project.detections),
    }));
  }

  private mapDetectionsToPersonas(detections: { source: string; extra?: Record<string, unknown> }[]): PersonaType[] {
    const personas = new Set<PersonaType>();

    for (const detection of detections) {
      const mapped = DETECTION_SOURCE_MAP[detection.source];
      if (mapped) {
        personas.add(mapped);
        continue;
      }

      if (detection.source === 'cdp_roles' && detection.extra) {
        const roles = detection.extra['roles'] as { role: string }[] | undefined;
        if (roles?.some((r) => typeof r.role === 'string' && r.role.toLowerCase() === 'maintainer')) {
          personas.add('maintainer');
          continue;
        }
      }

      personas.add('contributor');
    }

    if (personas.size === 0) {
      personas.add('contributor');
    }

    // Drop contributor when a more specific role is present.
    if (personas.size > 1 && personas.has('contributor')) {
      personas.delete('contributor');
    }

    return Array.from(personas);
  }

  private buildPersonaProjectsMap(projects: EnrichedPersonaProject[]): Partial<Record<PersonaType, PersonaProject[]>> {
    const map: Partial<Record<PersonaType, PersonaProject[]>> = {};

    for (const project of projects) {
      const personaProject: PersonaProject = {
        projectUid: project.projectUid,
        projectSlug: project.projectSlug,
        projectName: project.projectName,
      };

      for (const persona of project.personas) {
        if (!map[persona]) {
          map[persona] = [];
        }
        map[persona]!.push(personaProject);
      }
    }

    return map;
  }

  private collectUniquePersonas(projects: EnrichedPersonaProject[]): PersonaType[] {
    const allPersonas = new Set<PersonaType>();

    for (const project of projects) {
      for (const persona of project.personas) {
        allPersonas.add(persona);
      }
    }

    return PERSONA_PRIORITY.filter((p) => allPersonas.has(p));
  }

  private extractOrganizations(req: Request, projects: EnrichedPersonaProject[]): Account[] {
    const seen = new Set<string>();
    const accounts: Account[] = [];

    for (const project of projects) {
      for (const detection of project.detections) {
        if (detection.source === 'board_member' && detection.extra) {
          const org = detection.extra['organization'] as { id?: unknown; name?: unknown } | undefined;
          const orgId = typeof org?.id === 'string' ? org.id : '';
          const orgName = typeof org?.name === 'string' ? org.name : '';

          logger.debug(req, 'extract_organizations', 'Processing board_member detection', {
            project_slug: project.projectSlug,
            has_org: !!org,
            org_id: orgId || null,
            org_name: orgName || null,
          });

          if (orgId && orgName && !seen.has(orgId)) {
            seen.add(orgId);
            accounts.push({ accountId: orgId, accountName: orgName });
          }
        }
      }
    }

    logger.debug(req, 'extract_organizations', 'Organization extraction complete', {
      total_accounts: accounts.length,
      accounts: accounts.map((a) => ({ id: a.accountId, name: a.accountName })),
    });

    return accounts;
  }

  private applyForcedPersona(personas: PersonaType[], forced: PersonaType): PersonaType[] {
    const filtered = personas.filter((p) => p !== forced);
    return [forced, ...filtered];
  }
}
