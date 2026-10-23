// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants/mktg-artifact.constants';
import { MKTG_DOCUMENT_ID_REGEX, MKTG_REVISION_ID_REGEX } from '@lfx-one/shared/constants/mktg-document-store.constants';
import { findMktgDocumentType } from '@lfx-one/shared/utils/mktg-document-store.utils';
import type { Request, Response, NextFunction } from 'express';

import { AuthorizationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MktgSignOffChecksService } from '../services/mktg-sign-off-checks.service';
import { ProjectService } from '../services/project.service';

export class MktgSignOffChecksController {
  private readonly projects = new ProjectService();
  private readonly checks = new MktgSignOffChecksService();

  public async getChecks(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_sign_off_checks';
    const project = req.query['project'];
    const type = findMktgDocumentType(String(req.params['agentKey'] ?? ''));
    const documentId = req.params['documentId'];
    const revisionId = req.params['revisionId'];
    if (typeof project !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(project)) {
      next(ServiceValidationError.forField('project', 'A single-segment project uid is required.'));
      return;
    }
    if (
      !type ||
      typeof documentId !== 'string' ||
      !MKTG_DOCUMENT_ID_REGEX.test(documentId) ||
      typeof revisionId !== 'string' ||
      !MKTG_REVISION_ID_REGEX.test(revisionId)
    ) {
      next(ServiceValidationError.forField('revision', 'A registered document and revision are required.'));
      return;
    }
    const started = logger.startOperation(req, operation, {});
    try {
      const resolved = await this.projects.getProjectById(req, project, true);
      if (!resolved.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(resolved.uid)) throw new AuthorizationError('Write access to this project is required.');
      const response = await this.checks.checksFor(req, resolved.uid, type, documentId, revisionId);
      res.setHeader('Cache-Control', 'private, no-store');
      logger.success(req, operation, started, { checks: response.checks.length });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
