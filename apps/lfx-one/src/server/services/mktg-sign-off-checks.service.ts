// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_SPECS } from '@lfx-one/shared/constants';
import type { MktgDocumentType, MktgSignOffChecksResponse } from '@lfx-one/shared/interfaces';
import { mktgSignOffChecks } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { logger } from './logger.service';

/** Read-only: the controller supplies the writer-authorized canonical project. */
export class MktgSignOffChecksService {
  private readonly documents = new MktgDocumentStoreService();

  public async checksFor(req: Request, project: string, type: MktgDocumentType, documentId: string, revisionId: string): Promise<MktgSignOffChecksResponse> {
    if (type.kind !== 'living') throw ServiceValidationError.forField('agentKey', 'Sign-off checks apply to living documents.');
    logger.debug(req, 'mktg_sign_off_checks_read', 'Evaluating stored-asset checks', { agentKey: type.agentKey });
    const view = await this.documents.getRevision(req, project, type, documentId, revisionId);
    if (!view) throw new ResourceNotFoundError('Marketing OS document revision', revisionId);
    let content: unknown;
    if (type.agentKey === 'brand-kit') content = view.sidecar;
    else {
      if (view.revision.format !== 'json') throw ServiceValidationError.forField('revisionId', 'Checks require stored structured content.');
      try {
        content = JSON.parse(view.markdown) as unknown;
      } catch {
        throw new MicroserviceError('Stored asset JSON is unreadable', 502, 'MKTG_SIGN_OFF_ASSET_UNREADABLE');
      }
    }
    const framework =
      type.agentKey === 'foundation-message'
        ? null
        : await this.documents.readLatest(req, MKTG_ARTIFACT_SPECS['foundation-message'], project, { withSidecar: true });
    return { checks: mktgSignOffChecks(type.agentKey, content, framework?.sidecar?.['content'], view.sidecar) };
  }
}
