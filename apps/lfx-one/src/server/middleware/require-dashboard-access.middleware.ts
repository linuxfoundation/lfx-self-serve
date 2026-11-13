// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PROJECT_ANCESTRY_MAX_DEPTH, PROJECT_PARTICIPATING_ORGS_SLUG_PATTERN, ROOT_PROJECT_SLUG } from '@lfx-one/shared/constants';
import type { PersonaType, Project } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ServiceValidationError } from '../errors';
import { personaDetectionService } from '../utils/persona-helper';
import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';

const ED: PersonaType = 'executive-director';

// Dashboard access admits the same callers as the client-side dashboardAccessGuard: EDs and LF Staff,
// via server-verified personas (never the spoofable cookie); ED scope is per-foundation, and a root
// writer passes it only when it also holds `writer_guard` on the named foundation.
export async function requireDashboardAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await personaDetectionService.getPersonas(req);
    const isED = result.personas.includes(ED);

    if (!isED && !result.isLFStaff) {
      logger.warning(req, 'require_dashboard_access', 'User without dashboard access attempted an executive-dashboard endpoint', {
        path: req.path,
        personas: result.personas,
      });

      next(
        new AuthorizationError('Executive dashboard access required for this resource', {
          operation: 'require_dashboard_access',
          service: 'authorization',
          path: req.path,
          code: 'DASHBOARD_ACCESS_REQUIRED',
        })
      );
      return;
    }

    const rawSlug = req.method === 'POST' ? req.body?.['foundationSlug'] : req.query['foundationSlug'];
    const requestedSlug = typeof rawSlug === 'string' ? rawSlug.toLowerCase() : '';

    // No slug on the request means there is nothing to scope against — the handler is responsible
    // for rejecting a missing required parameter, and unscoped dashboard endpoints stay allowed.
    if (!requestedSlug || result.isLFStaff) {
      next();
      return;
    }

    // Upstream project slugs are verbatim — normalize case on both sides so mixed-case data can't 403 a scoped ED.
    const edSlugs = (result.personaProjects?.[ED] ?? []).map((project) => project.projectSlug.toLowerCase());
    if (edSlugs.includes(requestedSlug.toLowerCase())) {
      next();
      return;
    }

    // A root writer is trusted per foundation, not across the board: the ROOT check admits
    // `global_writer`, which is withheld on some projects, so the named foundation must agree.
    if (result.isRootWriter && (await personaDetectionService.checkProjectWriter(req, requestedSlug))) {
      next();
      return;
    }

    logger.warning(req, 'require_dashboard_access', 'ED requested a foundation outside their scope', {
      path: req.path,
      requested_slug: requestedSlug,
      scoped_slugs: edSlugs,
    });

    next(
      new AuthorizationError('Executive dashboard access required for this resource', {
        operation: 'require_dashboard_access',
        service: 'authorization',
        path: req.path,
        code: 'DASHBOARD_ACCESS_REQUIRED',
      })
    );
  } catch (error) {
    next(error);
  }
}

// Variant for routes keyed by a *project* slug (e.g. `/api/projects/:slug/participating-orgs*`), where
// `foundationSlug` is absent so `requireDashboardAccess` would skip scoping. LF Staff pass outright. An executive
// director passes only for a project that is, or sits under, a foundation they direct: the project's parent chain
// is read server-side (metadata only) and matched against the ED's scoped projects. A root writer, who carries the
// ED persona without ED scopes, passes only with writer access on the confirmed topmost foundation (the project
// just below the hidden ROOT), never on ROOT itself and never when the chain could not be fully resolved.
// The route's own `requireProjectParticipatingOrgsAccess` (project `viewer`) still runs after this gate.
const projectService = new ProjectService();

export async function requireExecutiveOrLFStaff(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const operation = 'require_executive_or_lf_staff';

  try {
    const slug = req.params['slug'];
    if (typeof slug !== 'string' || !PROJECT_PARTICIPATING_ORGS_SLUG_PATTERN.test(slug)) {
      throw ServiceValidationError.forField('slug', 'Invalid project slug format', { operation });
    }

    const result = await personaDetectionService.getPersonas(req);

    if (result.isLFStaff) {
      next();
      return;
    }

    if (!result.personas.includes(ED)) {
      logger.warning(req, operation, 'User without dashboard access attempted an executive-only project endpoint', {
        path: req.path,
        personas: result.personas,
      });
      next(denied(req, operation));
      return;
    }

    const edProjects = result.personaProjects?.[ED] ?? [];
    const edUids = new Set(edProjects.map((project) => project.projectUid));
    const edSlugs = new Set(edProjects.map((project) => project.projectSlug.toLowerCase()));

    // The requested project: an unknown slug is left to the viewer gate (404); an outage surfaces as itself.
    const { uid, exists } = await projectService.getProjectIdBySlug(req, slug, { unavailableAsMissing: false });
    if (!exists) {
      next();
      return;
    }

    // Climb project -> parent -> ... Ancestor reads are metadata-only (`access: false`) and fail closed: an
    // unreadable ancestor ends the climb as "incomplete", which can never grant the root-writer fallback.
    let project: Project = await projectService.getProjectById(req, uid, false);
    let foundation: Project | null = null;
    let complete = false;
    for (let depth = 0; depth < PROJECT_ANCESTRY_MAX_DEPTH; depth++) {
      if (edUids.has(project.uid) || edSlugs.has((project.slug ?? '').toLowerCase())) {
        next();
        return;
      }
      foundation = project;

      if (!project.parent_uid) {
        complete = true;
        break;
      }
      if (edUids.has(project.parent_uid)) {
        next();
        return;
      }

      let parent: Project;
      try {
        parent = await projectService.getProjectById(req, project.parent_uid, false);
      } catch (error) {
        // Caller-reachable (an unreadable ancestor), so DEBUG rather than a floodable WARN.
        logger.debug(req, operation, 'Project ancestry lookup ended before a foundation was confirmed', { slug, err: error });
        break;
      }
      if (parent.slug === ROOT_PROJECT_SLUG) {
        complete = true;
        break;
      }
      project = parent;
    }

    if (complete && result.isRootWriter && foundation && (await personaDetectionService.checkProjectWriter(req, foundation.slug))) {
      next();
      return;
    }

    logger.warning(req, operation, 'ED requested a project outside their foundation scope', { path: req.path, requested_slug: slug });
    next(denied(req, operation));
  } catch (error) {
    next(error);
  }
}

function denied(req: Request, operation: string): AuthorizationError {
  return new AuthorizationError('Executive dashboard access required for this resource', {
    operation,
    service: 'authorization',
    path: req.path,
    code: 'DASHBOARD_ACCESS_REQUIRED',
  });
}
