// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PERSONA_ENRICHMENT_BULK_THRESHOLD } from '@lfx-one/shared/constants';
import {
  BOARD_SCOPED_PERSONAS,
  EnrichedPersonaProject,
  PersonaApiResponse,
  PersonaProject,
  PersonaType,
  PROJECT_SCOPED_PERSONAS,
  Project,
} from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from './logger.service';
import { PersonaDetectionService } from './persona-detection.service';
import { ProjectService } from './project.service';

/**
 * Enriches persona-detected projects with metadata (name, logo, parent, description, isFoundation).
 * Chooses between per-project GETs or a single paginated query-service fetch based on project count.
 */
export class PersonaEnrichmentService {
  private readonly projectService: ProjectService;
  private readonly personaDetectionService: PersonaDetectionService;

  public constructor(personaDetectionService: PersonaDetectionService) {
    this.projectService = new ProjectService();
    this.personaDetectionService = personaDetectionService;
  }

  /**
   * Returns a PersonaApiResponse with projects enriched from the project service.
   * On error or empty projects, returns the base response unchanged so callers degrade gracefully.
   */
  public async getEnrichedPersonas(req: Request): Promise<PersonaApiResponse> {
    const base = await this.personaDetectionService.getPersonas(req);

    if (base.error || base.projects.length === 0) {
      logger.debug(req, 'get_enriched_personas', 'Skipping enrichment — no projects or upstream error', {
        project_count: base.projects.length,
        has_error: !!base.error,
      });
      return base;
    }

    const useBulk = base.projects.length >= PERSONA_ENRICHMENT_BULK_THRESHOLD;
    const path = useBulk ? 'bulk' : 'individual';

    logger.info(req, 'get_enriched_personas', 'Enriching persona-detected projects', {
      project_count: base.projects.length,
      path,
    });

    const enriched = useBulk ? await this.enrichFromBulk(req, base.projects) : await this.enrichIndividually(req, base.projects);

    const personaProjects = this.buildPersonaProjectsMap(enriched);

    return {
      ...base,
      projects: enriched,
      personaProjects,
    };
  }

  private async enrichIndividually(req: Request, projects: EnrichedPersonaProject[]): Promise<EnrichedPersonaProject[]> {
    logger.debug(req, 'enrich_personas_individually', 'Fetching projects individually', {
      project_count: projects.length,
    });

    const results = await Promise.all(
      projects.map(async (project) => {
        try {
          const fetched = await this.projectService.getProjectById(req, project.projectUid, false);
          return this.mergeProject(project, fetched);
        } catch (error) {
          logger.warning(req, 'enrich_personas_individually', 'Failed to fetch project for enrichment, keeping un-enriched entry', {
            project_uid: project.projectUid,
            project_slug: project.projectSlug,
            err: error,
          });
          return project;
        }
      })
    );

    return results;
  }

  private async enrichFromBulk(req: Request, projects: EnrichedPersonaProject[]): Promise<EnrichedPersonaProject[]> {
    logger.debug(req, 'enrich_personas_bulk', 'Fetching all projects via query service', {
      persona_project_count: projects.length,
    });

    let fetched: Project[] = [];
    try {
      fetched = await this.projectService.getProjects(req, {});
    } catch (error) {
      logger.warning(req, 'enrich_personas_bulk', 'Bulk project fetch failed, returning un-enriched projects', {
        err: error,
      });
      return projects;
    }

    const foundations = new Map<string, Project>();
    const nonFoundations = new Map<string, Project>();

    for (const proj of fetched) {
      if (!proj?.uid) continue;
      if (computeIsFoundation(proj)) {
        foundations.set(proj.uid, proj);
      } else {
        nonFoundations.set(proj.uid, proj);
      }
    }

    logger.debug(req, 'enrich_personas_bulk', 'Partitioned projects by foundation', {
      foundations_count: foundations.size,
      non_foundations_count: nonFoundations.size,
    });

    return projects.map((project) => {
      const hasFoundationPersona = project.personas.some((p) => BOARD_SCOPED_PERSONAS.has(p));
      const hasNonFoundationPersona = project.personas.some((p) => PROJECT_SCOPED_PERSONAS.has(p));

      let match: Project | undefined;
      if (hasFoundationPersona) {
        match = foundations.get(project.projectUid) ?? (hasNonFoundationPersona ? nonFoundations.get(project.projectUid) : undefined);
      } else if (hasNonFoundationPersona) {
        match = nonFoundations.get(project.projectUid) ?? foundations.get(project.projectUid);
      } else {
        match = foundations.get(project.projectUid) ?? nonFoundations.get(project.projectUid);
      }

      if (!match) {
        logger.debug(req, 'enrich_personas_bulk', 'No matching project in bulk result, keeping un-enriched entry', {
          project_uid: project.projectUid,
          project_slug: project.projectSlug,
        });
        return project;
      }

      return this.mergeProject(project, match);
    });
  }

  private mergeProject(base: EnrichedPersonaProject, project: Project): EnrichedPersonaProject {
    return {
      ...base,
      projectName: project.name ?? base.projectName,
      logoUrl: project.logo_url ? project.logo_url : null,
      parentProjectUid: project.parent_uid ? project.parent_uid : null,
      description: project.description ? project.description : null,
      isFoundation: computeIsFoundation(project),
    };
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
}
