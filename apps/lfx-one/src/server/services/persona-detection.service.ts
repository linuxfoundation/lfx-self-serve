// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NatsSubjects } from '@lfx-one/shared/enums';
import { EnrichedPersonaProject, PersonaApiResponse, PersonaDetectionResponse, PersonaProject, PersonaType, Project } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { NatsService } from './nats.service';
import { ProjectService } from './project.service';

/** Detection sources that map to specific personas */
const DETECTION_SOURCE_MAP: Record<string, PersonaType> = {
  board_member: 'board-member',
  executive_director: 'executive-director',
};

/** Persona priority order (highest first) for sorting */
const PERSONA_PRIORITY: PersonaType[] = ['board-member', 'executive-director', 'maintainer', 'contributor'];

/** TTL for the affiliated-project-UIDs cache, in milliseconds */
const AFFILIATED_PROJECT_UIDS_CACHE_TTL_MS = 15_000;

interface AffiliatedProjectUidsCacheEntry {
  /** In-flight (or resolved) promise — stored before awaiting to collapse concurrent lookups */
  promise: Promise<string[]>;
  expiresAt: number;
}

/**
 * Service for detecting user personas via the persona detection NATS RPC
 * and enriching results with project data for UI consumption
 */
export class PersonaDetectionService {
  private readonly natsService: NatsService;
  private readonly projectService: ProjectService;

  /**
   * Short-lived per-user cache for affiliated project UIDs.
   * Keyed by username (nickname claim) with email as fallback.
   * Stores the in-flight Promise so concurrent requests on the same page load
   * (e.g. events list + foundation dropdown) share a single NATS round-trip.
   */
  private readonly affiliatedUidsCache = new Map<string, AffiliatedProjectUidsCacheEntry>();

  public constructor() {
    this.natsService = new NatsService();
    this.projectService = new ProjectService();

    // Sweep expired cache entries every 60 s — well above the 15 s TTL — so
    // entries that are never re-requested don't accumulate indefinitely.
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.affiliatedUidsCache) {
        if (now >= entry.expiresAt) {
          this.affiliatedUidsCache.delete(key);
        }
      }
    }, 60_000).unref();
  }

  /**
   * Return only the project slugs the authenticated user is affiliated with.
   * Slugs are used (rather than persona-service UIDs) because PROJECT_SLUG is
   * the shared cross-reference key between the persona service and the datalake.
   *
   * Cache strategy:
   * - Keyed by username (nickname) with email as fallback; skips cache entirely
   *   when no stable identifier is present (prevents cross-user data leaks).
   * - Stores the in-flight Promise before awaiting so concurrent requests for
   *   the same user share a single NATS round-trip rather than each triggering
   *   their own (addresses the "events list + foundation dropdown" concurrency).
   * - Evicts stale entries eagerly on cache miss and on rejection to prevent
   *   memory growth and poisoned entries.
   *
   * Returns an empty array on error so callers degrade gracefully.
   */
  public async getAffiliatedProjectSlugs(req: Request): Promise<string[]> {
    const username = req.oidc?.user?.['nickname'] || '';
    const email = ((req.oidc?.user?.['email'] as string) || '').toLowerCase();
    const cacheKey = username || email;

    // No stable identifier — bypass cache to prevent cross-user data leaks.
    if (!cacheKey) {
      logger.debug(req, 'get_affiliated_project_slugs', 'No stable cache key, bypassing cache');
      return this.fetchAndResolveAffiliatedSlugs(req, username, email);
    }

    const cached = this.affiliatedUidsCache.get(cacheKey);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        logger.debug(req, 'get_affiliated_project_slugs', 'Returning cached affiliated project slugs', {
          cacheKey: '***',
        });
        return cached.promise;
      }
      // Stale — evict eagerly so the next caller fetches fresh data.
      this.affiliatedUidsCache.delete(cacheKey);
    }

    // Store the Promise *before* awaiting so concurrent callers retrieve and
    // await the same Promise instead of each triggering a separate NATS call.
    const promise = this.fetchAndResolveAffiliatedSlugs(req, username, email);
    this.affiliatedUidsCache.set(cacheKey, { promise, expiresAt: Date.now() + AFFILIATED_PROJECT_UIDS_CACHE_TTL_MS });

    // Remove on rejection so a failed lookup doesn't poison the cache.
    promise.catch(() => this.affiliatedUidsCache.delete(cacheKey));

    return promise;
  }

  /**
   * Get enriched persona data for the authenticated user
   * Calls the persona detection service via NATS, enriches with project names,
   * and maps detections to persona types
   */
  public async getPersonas(req: Request): Promise<PersonaApiResponse> {
    const username = req.oidc?.user?.['nickname'] || '';
    const email = (req.oidc?.user?.['email'] as string) || '';

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
        multiProject: false,
        multiFoundation: false,
        error: detectionResponse.error.message,
      };
    }

    if (detectionResponse.projects.length === 0) {
      logger.debug(req, 'get_personas', 'No persona detections found for user');

      return {
        personaProjects: {},
        personas: ['contributor'],
        projects: [],
        multiProject: false,
        multiFoundation: false,
        error: null,
      };
    }

    // Enrich projects with names in parallel
    const enrichedProjects = await this.enrichProjectsWithNames(req, detectionResponse);

    // Build persona-centric mapping
    const personaProjects = this.buildPersonaProjectsMap(enrichedProjects);

    // Collect all unique personas sorted by priority
    const personas = this.collectUniquePersonas(enrichedProjects);

    // Compute multi-access flags from enriched projects
    const uniqueProjectUids = new Set(enrichedProjects.map((p) => p.projectUid));
    const multiProject = uniqueProjectUids.size > 1;

    const foundationUids = new Set(enrichedProjects.map((p) => (p.isFoundation ? p.projectUid : p.parentProjectUid || p.projectUid)));
    const multiFoundation = foundationUids.size > 1;

    logger.debug(req, 'get_personas', 'Persona detection complete', {
      project_count: enrichedProjects.length,
      persona_count: personas.length,
      personas,
      foundation_count: foundationUids.size,
    });

    return {
      personaProjects,
      personas,
      projects: enrichedProjects,
      multiProject,
      multiFoundation,
      error: null,
    };
  }

  /** Fetch persona detections and resolve to a deduplicated list of project slugs. */
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

  /**
   * Call the persona detection service via NATS RPC
   */
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

      // Validate response shape — normalize malformed fields to prevent downstream crashes
      const normalized = {
        projects: Array.isArray(parsed?.projects)
          ? parsed.projects.map((p: Record<string, unknown>) => ({
              project_uid: p['project_uid'] || '',
              project_slug: p['project_slug'] || '',
              detections: Array.isArray(p['detections']) ? p['detections'] : [],
            }))
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
      logger.warning(req, 'fetch_persona_detections', 'NATS persona detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        error_name: error instanceof Error ? error.constructor.name : 'Unknown',
      });

      return { projects: [], error: { code: 'nats_error', message: 'Failed to fetch persona detections' } };
    }
  }

  /**
   * Enrich raw detection projects with project names via parallel REST lookups
   */
  private async enrichProjectsWithNames(req: Request, response: PersonaDetectionResponse): Promise<EnrichedPersonaProject[]> {
    const results = await Promise.allSettled(
      response.projects.map(async (project) => {
        let projectName: string | null = null;
        let parentProjectUid: string | null = null;
        let isFoundation = false;
        let logoUrl: string | null = null;
        let description: string | null = null;

        try {
          const projectData = await this.projectService.getProjectById(req, project.project_uid, false);
          projectName = projectData?.name || null;
          parentProjectUid = projectData?.parent_uid || null;
          isFoundation = this.computeIsFoundation(projectData);
          logoUrl = projectData?.logo_url || null;
          description = projectData?.description || null;
        } catch {
          logger.debug(req, 'enrich_project_name', 'Failed to fetch project data, using null', {
            project_uid: project.project_uid,
          });
        }

        const personas = this.mapDetectionsToPersonas(project.detections);

        return {
          projectUid: project.project_uid,
          projectSlug: project.project_slug,
          projectName,
          parentProjectUid,
          isFoundation,
          logoUrl,
          description,
          detections: project.detections,
          personas,
        } as EnrichedPersonaProject;
      })
    );

    return results.filter((r): r is PromiseFulfilledResult<EnrichedPersonaProject> => r.status === 'fulfilled').map((r) => r.value);
  }

  /**
   * Map detection sources to persona types
   * - board_member → 'board-member'
   * - executive_director → 'executive-director'
   * - cdp_roles with Maintainer role → 'maintainer'
   * - Everything else → 'contributor'
   */
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
        if (roles?.some((r) => r.role === 'Maintainer')) {
          personas.add('maintainer');
          continue;
        }
      }

      personas.add('contributor');
    }

    if (personas.size === 0) {
      personas.add('contributor');
    }

    return Array.from(personas);
  }

  /**
   * Build a mapping of persona → projects for lens navigation filtering
   */
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

  /**
   * Collect unique personas from all projects, sorted by priority (highest first)
   */
  private collectUniquePersonas(projects: EnrichedPersonaProject[]): PersonaType[] {
    const allPersonas = new Set<PersonaType>();

    for (const project of projects) {
      for (const persona of project.personas) {
        allPersonas.add(persona);
      }
    }

    return PERSONA_PRIORITY.filter((p) => allPersonas.has(p));
  }

  /**
   * Compute whether a project is foundation-level using business criteria.
   * Mirrors the lfx-pcc hasHealthMetricDashboard logic mapped to V2 project fields:
   * - Stage must be 'Active'
   * - Legal entity type must not be 'Internal Allocation'
   * - Funding model must include 'Membership'
   */
  private computeIsFoundation(project: Project | null): boolean {
    if (!project) {
      return false;
    }

    return (
      project.stage === 'Active' &&
      project.legal_entity_type !== 'Internal Allocation' &&
      Array.isArray(project.funding_model) &&
      project.funding_model.includes('Membership')
    );
  }
}
