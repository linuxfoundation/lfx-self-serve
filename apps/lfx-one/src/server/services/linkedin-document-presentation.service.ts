// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_POST_INTAKE, LINKEDIN_PRESENTATION_KEY } from '@lfx-one/shared/constants';
import { LinkedinDocumentContent, LinkedinShareLinkResponse } from '@lfx-one/shared/interfaces';
import { buildMktgDocumentPrefix, normalizeLinkedinShareLink } from '@lfx-one/shared/utils';
import { Request } from 'express';
import { createHash } from 'node:crypto';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { ObjectStoreService } from './object-store.service';

/**
 * Mutable link overlay only. The generic document store resolves revision authors
 * from author-id metadata; this service never trusts attribution in a sidecar.
 */
export class LinkedinDocumentPresentationService {
  private readonly store = new ObjectStoreService();

  public async read(req: Request, project: string, documentId: string, content: LinkedinDocumentContent): Promise<LinkedinDocumentContent> {
    const object = await this.store.getObject(req, 'marketing-os-artifacts', this.key(project, documentId));
    let link = content.answers['share_link'];
    if (object) {
      try {
        const value: unknown = JSON.parse(object.body);
        const saved = value && typeof value === 'object' && 'share_link' in value ? normalizeLinkedinShareLink(value.share_link) : null;
        if (saved === null || object.metadata['content-sha256'] !== createHash('sha256').update(object.body).digest('hex')) throw this.invalidStored();
        link = saved;
      } catch {
        throw this.invalidStored();
      }
    }
    // Whitelist card fields: attribution in an old/forged sidecar is never authoritative.
    const { options, notes, source } = content;
    return {
      options,
      notes,
      ...(source ? { source } : {}),
      answers: { share_link: link },
    };
  }

  /** Caller has already validated document existence and the project's writer entitlement. */
  public async save(req: Request, project: string, documentId: string, value: unknown, initialize = false): Promise<LinkedinShareLinkResponse> {
    const link = normalizeLinkedinShareLink(value);
    if (link === null) throw ServiceValidationError.forField('share_link', 'Enter one HTTPS link or leave it empty.');
    const result = { share_link: link };
    const body = Buffer.from(JSON.stringify(result));
    const input = {
      body,
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'private, no-store',
      metadata: { 'content-sha256': createHash('sha256').update(body).digest('hex') },
    };
    if (initialize) await this.store.putPrivateObjectIfAbsent(req, 'marketing-os-artifacts', this.key(project, documentId), input);
    else await this.store.putMutableObject(req, 'marketing-os-artifacts', this.key(project, documentId), input);
    return result;
  }

  private key(project: string, documentId: string): string {
    return `${buildMktgDocumentPrefix(project, LINKEDIN_POST_INTAKE.agentId, documentId)}${LINKEDIN_PRESENTATION_KEY}`;
  }
  private invalidStored(): MicroserviceError {
    return new MicroserviceError('Saved link metadata is invalid.', 500, 'LINKEDIN_PRESENTATION_INVALID', {
      operation: 'linkedin_presentation_read',
      service: 'object_store',
    });
  }
}
