// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EnrichedPersonaProject, PersonaApiResponse, PersonaProject, PersonaType, Project } from '@lfx-one/shared/interfaces';
import { computeIsFoundation } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from './logger.service';
import { PersonaDetectionService } from './persona-detection.service';
import { ProjectService } from './project.service';

/**
 * Enriches persona-detected projects with metadata (name, logo, parent, description, isFoundation)
 * using a single batched query-service call keyed by project UID.
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

    logger.info(req, 'get_enriched_personas', 'Enriching persona-detected projects', {
      project_count: base.projects.length,
    });

    const uids = base.projects.map((p) => p.projectUid).filter(Boolean);
    const byUid = await this.projectService.getProjectsByIds(req, uids);

    const enriched = base.projects.map((project) => {
      const match = byUid.get(project.projectUid);
      if (!match) {
        logger.debug(req, 'get_enriched_personas', 'No matching project returned from batch, keeping un-enriched entry', {
          project_uid: project.projectUid,
          project_slug: project.projectSlug,
        });
        return project;
      }
      return this.mergeProject(project, match);
    });

    const personaProjects = this.buildPersonaProjectsMap(enriched);

    return { ...base, projects: enriched, personaProjects };
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
