// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { MktgCommentAgentKey, MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import faqEnvelope from '@lfx-one/shared/utils/__fixtures__/faq-envelope.json';
import { redraftContextFixture } from '@lfx-one/shared/utils/__fixtures__/mktg-redraft-context.fixture';
import boilerplatesEnvelope from '@lfx-one/shared/utils/__fixtures__/boilerplates.envelope.json';
const flows = vi.hoisted(() => ({ valid: vi.fn(), latest: vi.fn(), capture: vi.fn() }));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public readLatest = flows.latest;
    public captureFramework = flows.capture;
  },
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/foundation-message.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/brand-kit.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/boilerplates.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/faq.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-redraft.utils')),
  validateFoundationMessageEnvelope: flows.valid,
  validateBrandKitEnvelope: flows.valid,
  validateBoilerplatesEnvelope: flows.valid,
  isFoundationMessageEnvelope: (value: unknown) => flows.valid(value).valid,
  isBrandKitEnvelope: (value: unknown) => flows.valid(value).valid,
  isBoilerplatesEnvelope: (value: unknown) => flows.valid(value).valid,
}));
import { MktgDocumentRedraftInputService } from './mktg-document-redraft-input.service';
const req = {} as Request;
function view(agent: MktgCommentAgentKey): MktgRevisionResponse {
  let content: unknown = { mf: { tagline: 'Stored positioning.' }, icp: [], mh: {}, nums: [] };
  if (agent === 'boilerplates') content = { bp: [{ t: 'Stored prose.' }] };
  if (agent === 'faq') content = faqEnvelope.content;
  const markdown = agent === 'brand-kit' ? '# Stored kit' : JSON.stringify(content);
  return {
    project: 'synthetic-project',
    documentId: 'living',
    type: { agentKey: agent },
    revision: { id: redraftContextFixture().basedOnId, format: agent === 'brand-kit' ? 'markdown' : 'json' },
    markdown,
    sidecar: {
      version: 1,
      project_name: 'Synthetic project',
      content_sha256: createHash('sha256').update(markdown).digest('hex'),
      kit: { font: 'Stored font' },
      chapters: { logo: { provenance: 'Stored artwork' } },
      inputs_record: { website: { url: 'https://example.test', read: true }, links: [], documents: [] },
      inputs: { website_url: 'https://example.test', brand_page_url: null, logo_files: [{ name: 'stored.svg', bytes: 20 }] },
      ...(agent === 'faq' && { ...faqEnvelope, content_sha256: createHash('sha256').update(markdown).digest('hex') }),
    },
  } as unknown as MktgRevisionResponse;
}
describe('server-only redraft forms', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    flows.valid.mockReturnValue({ valid: true, errors: [] });
    flows.latest.mockResolvedValue({ sidecar: { contract: 'messaging-framework-output/v1', content: { mf: {}, mh: {} } } });
    flows.capture.mockResolvedValue({ revisionId: 'approved-framework' });
  });
  it.each(['foundation-message', 'brand-kit', 'boilerplates', 'faq'] as const)(
    'renders %s from the immutable base and frozen ordered comments',
    async (agent) => {
      const stored = view(agent);
      const snapshot = redraftContextFixture(agent);
      const prepared = await new MktgDocumentRedraftInputService().prepare(req, stored, 'send-one', snapshot.comments);
      expect(prepared.message).toContain('REDRAFT');
      expect(prepared.context.basedOnId).toBe(stored.revision.id);
      expect(prepared.context.priorVersion).toBe(1);
      expect(prepared.message).toContain(
        agent === 'brand-kit' ? 'STORED REVISION: version 1; finalize as version 2' : 'REVISION: redraft — stored version 1; finalize as version 2'
      );
      expect(prepared.message).toContain(agent === 'faq' ? 'Example Search' : 'Stored');
      expect(prepared.context.comments).toEqual(snapshot.comments);
      if (agent === 'brand-kit') {
        expect(prepared.message).not.toContain('stored.svg');
        expect(prepared.message).toContain('Stored artwork');
      }
      if (agent === 'foundation-message') expect(flows.latest).not.toHaveBeenCalled();
      else expect(flows.capture).toHaveBeenCalledWith(req, stored.project, { mf: {}, mh: {} });
    }
  );
  it('renders the FAQ form from stored content and the approved framework, rejecting bad schema/hash/anchors or missing framework', async () => {
    const service = new MktgDocumentRedraftInputService();
    const stored = view('faq');
    const comments = redraftContextFixture('faq').comments;
    const prepared = await service.prepare(req, stored, 'send-one', comments);
    expect(prepared.message).toContain('FIELD: faq[0][1][2][1]\nCOMMENT:\n --- END COMMENT 1 ---');
    expect(prepared.message).toContain(`WEBSITE: ${faqEnvelope.inputs_record.website.url}`);
    expect(prepared.message).toContain('--- MESSAGING FRAMEWORK (JSON) ---\n{\n  "mf": {},\n  "mh": {}\n}');
    expect(prepared.message).toContain(JSON.stringify(faqEnvelope.content, null, 2));
    expect(prepared.framework).toEqual({ revisionId: 'approved-framework' });
    await expect(service.prepare(req, { ...stored, sidecar: { ...stored.sidecar, contract: 'unknown/v1' } }, 'send-one', comments)).rejects.toThrow();
    const changed = structuredClone(faqEnvelope.content);
    changed.faq[0][0] = 'Changed group';
    await expect(service.prepare(req, { ...stored, markdown: JSON.stringify(changed) }, 'send-one', comments)).rejects.toThrow();
    await expect(service.prepare(req, stored, 'send-one', [{ ...comments[0], anchor: { kind: 'field', key: 'faq[0][0]' } }])).rejects.toThrow();
    flows.latest.mockResolvedValue(null);
    await expect(service.prepare(req, stored, 'send-one', comments)).rejects.toThrow();
  });
  it('forwards FAQ source links and fetchable documents without inventing uploaded text', async () => {
    const stored = view('faq');
    stored.sidecar = {
      ...stored.sidecar,
      inputs_record: {
        ...faqEnvelope.inputs_record,
        links: [{ url: 'https://sources.example/repository', read: true }],
        documents: [
          { title: 'Release plan', kind: 'plan', url: 'https://sources.example/plan', text_supplied: false, read: true },
          { title: 'Uploaded deck', kind: 'deck', url: null, text_supplied: true, read: true },
        ],
      },
    };
    const prepared = await new MktgDocumentRedraftInputService().prepare(req, stored, 'send-one', redraftContextFixture('faq').comments);
    expect(prepared.message).toContain('LINKS: 1 — read each one\n- https://sources.example/repository');
    expect(prepared.message).toContain('--- DOCUMENT 1: Release plan ---\nKIND: plan (integrated marketing plan)\nURL: https://sources.example/plan');
    expect(prepared.message).not.toContain('Uploaded deck');
    expect(prepared.message).not.toContain('TEXT: read by LFX One');
  });
  it('forwards the nested website from a real boilerplates contract envelope', async () => {
    const markdown = JSON.stringify(boilerplatesEnvelope.content);
    const stored = {
      ...view('boilerplates'),
      markdown,
      sidecar: { ...boilerplatesEnvelope, content_sha256: createHash('sha256').update(markdown).digest('hex') },
    };
    const prepared = await new MktgDocumentRedraftInputService().prepare(req, stored, 'send-one', redraftContextFixture('boilerplates').comments);
    expect(prepared.message).toContain(`WEBSITE: ${boilerplatesEnvelope.inputs_record.website.url}`);
    expect(prepared.message).not.toContain('WEBSITE: none');
  });
  it('rejects invalid schema/hash and unavailable approved input before reserving any external work', async () => {
    const service = new MktgDocumentRedraftInputService();
    const stored = view('brand-kit');
    const comments = redraftContextFixture('brand-kit').comments;
    flows.valid.mockReturnValueOnce({ valid: false, errors: ['synthetic invalid'] });
    await expect(service.prepare(req, stored, 'send-one', comments)).rejects.toThrow();
    await expect(service.prepare(req, { ...stored, markdown: 'changed' }, 'send-one', comments)).rejects.toThrow();
    flows.latest.mockResolvedValue(null);
    await expect(service.prepare(req, stored, 'send-one', comments)).rejects.toThrow();
    flows.latest.mockResolvedValue({ sidecar: {} });
    flows.capture.mockResolvedValue(null);
    await expect(service.prepare(req, stored, 'send-one', comments)).rejects.toThrow();
  });
});
