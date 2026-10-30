// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BOILERPLATES_FORM_TYPE,
  BRAND_KIT_KIND,
  BRAND_KIT_REVISE_FORM_TYPE,
  FOUNDATION_MESSAGE_FORM_TYPE,
  FAQ_FORM_TYPE,
  FAQ_KIND,
  MKTG_ARTIFACT_SPECS,
  MKTG_DOCUMENT_COMMENT_LIMITS,
  MKTG_KIT_FRAMEWORK_KEY,
  MKTG_REDRAFT_CONTEXT_SCHEMA,
  MKTG_REDRAFT_CONTEXT_MAX_BYTES,
} from '@lfx-one/shared/constants';
import type { MktgCommentAgentKey, MktgPreparedRedraft, MktgRedraftCommentSnapshot, MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import {
  renderFoundationMessageFormText,
  validateFoundationMessageEnvelope,
  renderBrandKitFormText,
  validateBrandKitEnvelope,
  renderBoilerplatesFormText,
  validateBoilerplatesEnvelope,
  readMktgRedraftContext,
  isFoundationMessageEnvelope,
  isBrandKitEnvelope,
  isBoilerplatesEnvelope,
  isFaqEnvelope,
  renderFaqFormText,
  validateFaqEnvelope,
  toFaqFormDocument,
} from '@lfx-one/shared/utils';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { ServiceValidationError } from '../errors';
import { MktgDocumentStoreService } from './mktg-document-store.service';

/** Reads only server-authorized immutable assets; no caller previous JSON, routing or dependency bytes. */
export class MktgDocumentRedraftInputService {
  private readonly documents = new MktgDocumentStoreService();

  public async prepare(req: Request, view: MktgRevisionResponse, requestId: string, comments: MktgRedraftCommentSnapshot[]): Promise<MktgPreparedRedraft> {
    const agent = view.type.agentKey;
    if (!Object.hasOwn(MKTG_DOCUMENT_COMMENT_LIMITS, agent)) throw this.invalid();
    const data = this.decode(view);
    let valid: boolean;
    if (agent === MKTG_KIT_FRAMEWORK_KEY) valid = validateFoundationMessageEnvelope(data).valid;
    else if (agent === BRAND_KIT_KIND) valid = validateBrandKitEnvelope(data).valid;
    else if (agent === FAQ_KIND) valid = validateFaqEnvelope(data).valid;
    else valid = validateBoilerplatesEnvelope(data).valid;
    if (!valid) throw this.invalid();
    const bytes = view.revision.format === 'json' ? JSON.stringify(data['content']) : view.markdown;
    if (typeof bytes !== 'string') throw this.invalid();
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== data['content_sha256']) throw this.invalid();
    const context: MktgPreparedRedraft['context'] = {
      project: view.project,
      agentKey: agent as MktgCommentAgentKey,
      documentId: view.documentId,
      requestId,
      basedOnId: view.revision.id,
      priorVersion: Number(data['version']),
      projectName: String(data['project_name']),
      comments,
    };
    const descriptor = { ...context, schema: MKTG_REDRAFT_CONTEXT_SCHEMA, runId: '0'.repeat(64) };
    if (!readMktgRedraftContext(descriptor) || Buffer.byteLength(JSON.stringify(descriptor)) > MKTG_REDRAFT_CONTEXT_MAX_BYTES) throw this.invalid();
    if (agent === MKTG_KIT_FRAMEWORK_KEY) {
      if (!isFoundationMessageEnvelope(data)) throw this.invalid();
      const base = data;
      return {
        context,
        framework: null,
        message: renderFoundationMessageFormText({
          type: FOUNDATION_MESSAGE_FORM_TYPE,
          project_name: base.project_name,
          project_uid: view.project,
          website_url: base.inputs_record.website?.url,
          links: base.inputs_record.links.map((link) => link.url),
          documents: base.inputs_record.documents.filter((doc) => doc.url).map((doc) => ({ title: doc.title, kind: doc.kind, url: doc.url ?? undefined })),
          revision: {
            mode: 'redraft',
            prior_version: base.version,
            previous: { ...base.content },
            comments: comments.map((row) => ({ field: row.anchor.key, comment: row.text })),
          },
        }),
      };
    }
    const approved = await this.documents.readLatest(req, MKTG_ARTIFACT_SPECS[MKTG_KIT_FRAMEWORK_KEY], view.project, { withSidecar: true });
    if (!approved?.sidecar || !validateFoundationMessageEnvelope(approved.sidecar).valid) throw this.invalid();
    const frameworkContent = approved.sidecar['content'];
    const framework = await this.documents.captureFramework(req, view.project, frameworkContent);
    if (!framework) throw this.invalid();
    const messaging = approved.sidecar;
    if (agent === BRAND_KIT_KIND) {
      if (!isBrandKitEnvelope(data)) throw this.invalid();
      const base = data;
      // Stored chapters preserve artwork provenance. Input summaries are NOT original SVG/base64 files: never invent an upload/URL.
      return {
        context,
        framework,
        message: renderBrandKitFormText({
          type: BRAND_KIT_REVISE_FORM_TYPE,
          project_name: base.project_name,
          project_uid: view.project,
          prior_version: base.version,
          revision_mode: 'redraft',
          kit: base.kit,
          chapters: base.chapters,
          website_url: base.inputs.website_url ?? undefined,
          brand_page_url: base.inputs.brand_page_url ?? undefined,
          messaging_framework: messaging,
          comments: comments.map((row) => ({ passage: row.anchor.passage ?? '', comment: row.text })),
        }),
      };
    }
    if (agent === FAQ_KIND) {
      if (!isFaqEnvelope(data)) throw this.invalid();
      return {
        context,
        framework,
        message: renderFaqFormText({
          type: FAQ_FORM_TYPE,
          project_name: data.project_name,
          project_uid: view.project,
          website_url: data.inputs_record.website?.url,
          links: data.inputs_record.links.map((link) => link.url),
          // Input summaries retain URLs, not uploaded text: replay only fetchable documents.
          documents: data.inputs_record.documents
            .filter((doc) => doc.url)
            .map((doc) => toFaqFormDocument({ kind: 'link', title: doc.title, url: doc.url ?? undefined, tag: doc.kind })),
          messaging_framework: messaging,
          revision: {
            mode: 'redraft',
            prior_version: data.version,
            previous: data.content,
            comments: comments.map((row) => ({ field: row.anchor.key, comment: row.text })),
          },
        }),
      };
    }
    if (!isBoilerplatesEnvelope(data)) throw this.invalid();
    const base = data;
    const source = base.inputs_record['website'];
    const website = source && typeof source === 'object' && 'url' in source && typeof source.url === 'string' ? source.url : undefined;
    return {
      context,
      framework,
      message: renderBoilerplatesFormText({
        type: BOILERPLATES_FORM_TYPE,
        project_name: base.project_name,
        project_uid: view.project,
        website_url: website,
        messaging_framework: messaging,
        revision: {
          mode: 'redraft',
          prior_version: base.version,
          previous: base.content,
          comments: comments.map((row) => ({ field: row.anchor.key, comment: row.text })),
        },
      }),
    };
  }
  private decode(view: MktgRevisionResponse): Record<string, unknown> {
    if (!view.sidecar) throw this.invalid();
    try {
      return {
        ...view.sidecar,
        ...(view.revision.format === 'json' ? { content: JSON.parse(view.markdown) as unknown } : { document_markdown: view.markdown }),
      };
    } catch {
      throw this.invalid();
    }
  }
  private invalid(): ServiceValidationError {
    return ServiceValidationError.forField(
      'revision',
      'The stored asset or its approved framework cannot supply a valid redraft. Generate a new base with its sources first.'
    );
  }
}
