// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NatsSubjects } from '@lfx-one/shared/enums';
import { EnrichedPersonaProject, PersonaApiResponse, PersonaDetectionResponse, PersonaProject, PersonaType } from '@lfx-one/shared/interfaces';
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

/**
 * Service for detecting user personas via the persona detection NATS RPC
 * and enriching results with project data for UI consumption
 */
export class PersonaDetectionService {
  private readonly natsService: NatsService;
  private readonly projectService: ProjectService;

  public constructor() {
    this.natsService = new NatsService();
    this.projectService = new ProjectService();
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

    const foundationUids = new Set(enrichedProjects.map((p) => p.parentProjectUid || p.projectUid));
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

  /**
   * Call the persona detection service via NATS RPC
   */
  private async fetchPersonaDetections(req: Request, username: string, email: string): Promise<PersonaDetectionResponse> {
    try {
      const codec = this.natsService.getCodec();
      const payload = JSON.stringify({ username, email });
      const response = await this.natsService.request(NatsSubjects.PERSONAS_GET, codec.encode(payload), { timeout: 5000 });
      const decoded = codec.decode(response.data);

      const parsed = JSON.parse(decoded);

      // Validate response shape — normalize malformed fields to prevent downstream crashes
      return {
        projects: Array.isArray(parsed?.projects)
          ? parsed.projects.map((p: Record<string, unknown>) => ({
              project_uid: p['project_uid'] || '',
              project_slug: p['project_slug'] || '',
              detections: Array.isArray(p['detections']) ? p['detections'] : [],
            }))
          : [],
        error: parsed?.error ?? null,
      } as PersonaDetectionResponse;
    } catch (error) {
      logger.warning(req, 'fetch_persona_detections', 'NATS persona detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
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

        let logoUrl: string | null = null;
        let description: string | null = null;

        try {
          const projectData = await this.projectService.getProjectById(req, project.project_uid, false);
          projectName = projectData?.name || null;
          parentProjectUid = projectData?.parent_uid || null;
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
}
