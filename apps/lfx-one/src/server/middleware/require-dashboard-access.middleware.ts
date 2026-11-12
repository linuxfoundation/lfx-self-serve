// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { personaDetectionService } from '../utils/persona-helper';
import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';

import type { Project } from '@lfx-one/shared/interfaces';

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
// `foundationSlug` is absent so `requireDashboardAccess` would skip scoping. It admits LF Staff outright, and an
// executive director only for a project that is, or sits under, a foundation they direct: the project's parent
// chain is resolved server-side and matched against the ED's scoped projects. The route's own project `viewer`
// check still runs after this gate.
const MAX_PARENT_DEPTH = 6;
const projectService = new ProjectService();

export async function requireExecutiveOrLFStaff(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await personaDetectionService.getPersonas(req);

    if (result.isLFStaff) {
      next();
      return;
    }

    if (result.personas.includes(ED)) {
      const edProjects = result.personaProjects?.[ED] ?? [];
      const edUids = new Set(edProjects.map((project) => project.projectUid));
      const edSlugs = new Set(edProjects.map((project) => project.projectSlug.toLowerCase()));
      const slug = String(req.params['slug'] ?? '');

      // Walk project -> parent -> ... until an ED-scoped project is found or the chain ends. Lookups are
      // metadata-only (`access: false`) and fail closed: a missing or unreadable ancestor (e.g. the hidden
      // ROOT parent of a top-level project) ends the climb as "not in scope" rather than surfacing a 5xx.
      let topmost: { slug: string } | null = null;
      try {
        let project: Project | null = slug ? await projectService.getProjectBySlug(req, slug) : null;
        for (let depth = 0; project && depth < MAX_PARENT_DEPTH; depth++) {
          topmost = { slug: project.slug };
          if (edUids.has(project.uid) || edSlugs.has(String(project.slug ?? '').toLowerCase()) || (project.parent_uid && edUids.has(project.parent_uid))) {
            next();
            return;
          }
          project = project.parent_uid && depth + 1 < MAX_PARENT_DEPTH ? await projectService.getProjectById(req, project.parent_uid, false) : null;
        }
      } catch (error) {
        logger.warning(req, 'require_executive_or_lf_staff', 'Project ancestry lookup ended before a scoped foundation was found', {
          path: req.path,
          requested_slug: slug,
          err: error,
        });
      }

      // A root writer carries the ED persona without ED scopes: trust it per foundation, not across the board,
      // as `requireDashboardAccess` does — it must also hold writer access on the project's topmost foundation.
      if (result.isRootWriter && topmost && (await personaDetectionService.checkProjectWriter(req, topmost.slug))) {
        next();
        return;
      }

      logger.warning(req, 'require_executive_or_lf_staff', 'ED requested a project outside their foundation scope', {
        path: req.path,
        requested_slug: slug,
        scoped_slugs: [...edSlugs],
      });
    } else {
      logger.warning(req, 'require_executive_or_lf_staff', 'User without dashboard access attempted an executive-only project endpoint', {
        path: req.path,
        personas: result.personas,
      });
    }

    next(
      new AuthorizationError('Executive dashboard access required for this resource', {
        operation: 'require_executive_or_lf_staff',
        service: 'authorization',
        path: req.path,
        code: 'DASHBOARD_ACCESS_REQUIRED',
      })
    );
  } catch (error) {
    next(error);
  }
}
