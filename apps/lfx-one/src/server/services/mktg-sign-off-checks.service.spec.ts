// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { findMktgDocumentType } from '@lfx-one/shared/utils';
const mocks = vi.hoisted(() => ({ revision: vi.fn(), approved: vi.fn(), debug: vi.fn() }));
vi.mock('./logger.service', () => ({ logger: { debug: mocks.debug } }));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public getRevision = mocks.revision;
    public readLatest = mocks.approved;
  },
}));
import { MicroserviceError } from '../errors';
import { MktgSignOffChecksService } from './mktg-sign-off-checks.service';

const req = {} as Request;
function typeFor(key: string) {
  const type = findMktgDocumentType(key);
  if (!type) throw new Error('Missing synthetic type');
  return type;
}
const content = {
  mf: { tagline: 'Build together', avoid: [], goals: [{ id: 'adoption', icps: ['builders'], bite: 'Build tools together' }] },
  mh: { line: 'Build together' },
  icp: [{ goals: ['adoption'] }],
};

describe('MktgSignOffChecksService', () => {
  const service = new MktgSignOffChecksService();
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.revision.mockResolvedValue({ revision: { format: 'json' }, markdown: JSON.stringify(content), sidecar: null });
    mocks.approved.mockResolvedValue({ sidecar: { content } });
  });

  it('reads the selected immutable framework and evaluates its own fields without another framework read', async () => {
    const type = typeFor('foundation-message');
    const result = await service.checksFor(req, 'canonical-project', type, 'living', 'selected-id');
    expect(mocks.revision).toHaveBeenCalledWith(req, 'canonical-project', type, 'living', 'selected-id');
    expect(mocks.debug).toHaveBeenCalledWith(req, 'mktg_sign_off_checks_read', 'Evaluating stored-asset checks', { agentKey: type.agentKey });
    expect(result.checks).toHaveLength(5);
    expect(result.checks.find((row) => row.id === 'tagline')?.status).toBe('pass');
    expect(mocks.approved).not.toHaveBeenCalled();
  });

  it('uses approved-current readLatest, never a newer framework draft or client framework bytes', async () => {
    mocks.revision.mockResolvedValue({
      revision: { format: 'json' },
      markdown: JSON.stringify({ bp: [{ t: 'Useful tools', max: 10 }] }),
      sidecar: { checks: { word_counts: [99], findings: [] } },
    });
    const result = await service.checksFor(req, 'canonical-project', typeFor('boilerplates'), 'living', 'selected-id');
    expect(mocks.approved).toHaveBeenCalledWith(req, expect.objectContaining({ agentKey: 'foundation-message' }), 'canonical-project', { withSidecar: true });
    expect(result.checks.find((row) => row.id === 'words')?.status).toBe('pass');
    expect(result.checks).toHaveLength(6);
  });

  it('reads kit structure from the stored sidecar instead of its Markdown', async () => {
    mocks.revision.mockResolvedValue({
      revision: { format: 'markdown' },
      markdown: '# Not the checked source',
      sidecar: { chapters: { voice: { line: 'Build together' } } },
    });
    const result = await service.checksFor(req, 'canonical-project', typeFor('brand-kit'), 'living', 'selected-id');
    expect(result.checks.find((row) => row.id === 'tagline')?.status).toBe('pass');
  });

  it('reports unavailable dependency checks as n/a when no approved framework exists', async () => {
    mocks.revision.mockResolvedValue({ revision: { format: 'json' }, markdown: '{"bp":[{"t":"Useful tools","max":10}]}', sidecar: null });
    mocks.approved.mockResolvedValue(null);
    const result = await service.checksFor(req, 'canonical-project', typeFor('boilerplates'), 'living', 'selected-id');
    expect(result.checks.find((row) => row.id === 'avoid')?.status).toBe('n/a');
  });

  it('does not turn storage or approved-framework outages into passing or n/a checks', async () => {
    const failure = new MicroserviceError('Unavailable', 503, 'UNAVAILABLE');
    mocks.approved.mockRejectedValue(failure);
    await expect(service.checksFor(req, 'canonical-project', typeFor('boilerplates'), 'living', 'selected-id')).rejects.toBe(failure);
  });

  it('returns typed 404 for a missing revision without reading dependencies', async () => {
    mocks.revision.mockResolvedValue(null);
    await expect(service.checksFor(req, 'canonical-project', typeFor('foundation-message'), 'living', 'missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.approved).not.toHaveBeenCalled();
  });

  it('distinguishes corrupt JSON from an unsupported legacy prose revision', async () => {
    mocks.revision.mockResolvedValue({ revision: { format: 'json' }, markdown: '{' });
    await expect(service.checksFor(req, 'canonical-project', typeFor('faq'), 'living', 'selected-id')).rejects.toMatchObject({
      statusCode: 502,
      code: 'MKTG_SIGN_OFF_ASSET_UNREADABLE',
    });
    mocks.revision.mockResolvedValue({ revision: { format: 'markdown' }, markdown: '# Legacy' });
    await expect(service.checksFor(req, 'canonical-project', typeFor('faq'), 'living', 'selected-id')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects one-off runs before any document read', async () => {
    await expect(service.checksFor(req, 'canonical-project', typeFor('linkedin-post'), 'run-id', 'selected-id')).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.revision).not.toHaveBeenCalled();
  });
});
