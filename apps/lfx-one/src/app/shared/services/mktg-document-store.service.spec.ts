// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { MktgRevisionResponse, MktgRevisionSummary } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgDocumentStoreService } from './mktg-document-store.service';

/**
 * The Documents area client is a thin HTTP wrapper; what matters is the
 * contract the BFF routes expect: the project uid as the `project` query
 * param on reads and in the body of a restore, and path segments encoded.
 * A failed read is logged and rethrown, never turned into an empty answer.
 */
describe('MktgDocumentStoreService', () => {
  const REVISION_ID = `000002-${'a'.repeat(64)}`;

  let service: MktgDocumentStoreService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MktgDocumentStoreService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('lists the project’s documents', () => {
    service.listDocuments('proj-1').subscribe();

    const request = http.expectOne((candidate) => candidate.url === '/api/mktg-agents/documents');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('project')).toBe('proj-1');
    request.flush({ project: 'proj-1', groups: [] });
  });

  it('reads one document and one revision under the document’s path', () => {
    service.getDocument('proj-1', 'brand-kit', 'living').subscribe();
    service.getRevision('proj-1', 'brand-kit', 'living', REVISION_ID).subscribe();

    const document = http.expectOne((candidate) => candidate.url === '/api/mktg-agents/documents/brand-kit/living');
    expect(document.request.params.get('project')).toBe('proj-1');
    document.flush({});
    const revision = http.expectOne((candidate) => candidate.url === `/api/mktg-agents/documents/brand-kit/living/revisions/${REVISION_ID}`);
    expect(revision.request.params.get('project')).toBe('proj-1');
    revision.flush({});
  });

  it('carries a selected run on detail timer reads without requesting a failure refresh', () => {
    const runId = 'b'.repeat(64);
    service.getDocument('proj-1', 'brand-kit', 'living', true, undefined, false, runId).subscribe();
    const request = http.expectOne((candidate) => candidate.url === '/api/mktg-agents/documents/brand-kit/living');
    expect(request.request.params.get('run')).toBe(runId);
    expect(request.request.params.get('poll')).toBe('1');
    expect(request.request.params.has('refreshRun')).toBe(false);
    request.flush({});
  });

  function approvedRevision(): MktgRevisionResponse {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'foundation-message');
    if (!type) throw new Error('Missing document type');
    const approval = { approvedAt: '2026-10-19T10:00:00Z', approvedBy: { name: null } };
    const revision: MktgRevisionSummary = {
      id: REVISION_ID,
      number: 2,
      createdAt: '2026-10-19T09:00:00Z',
      origin: 'generated',
      restoredFromNumber: null,
      intakeMode: 'form',
      status: '',
      contentSha256: 'c'.repeat(64),
      format: 'json',
      commentCount: 0,
      latest: true,
      approval,
    };
    return {
      project: 'proj-1',
      type,
      documentId: 'living',
      revisions: [revision],
      revision,
      approval,
      approvedCurrent: { revisionId: revision.id, number: revision.number },
      markdown: 'Approved synthetic bytes',
      sidecar: null,
    };
  }

  it('returns no export payload without approved current and makes no request', () => {
    const next = vi.fn();
    service.getApprovedRevision({ ...approvedRevision(), approvedCurrent: null }).subscribe(next);
    expect(next).toHaveBeenCalledWith(null);
    http.expectNone(() => true);
  });

  it('reuses an exact already-approved viewed revision without fetching it again', () => {
    const approved = approvedRevision();
    const next = vi.fn();
    service.getApprovedRevision(approved, approved).subscribe(next);
    expect(next).toHaveBeenCalledWith(approved);
    http.expectNone(() => true);
  });

  it('refuses a cached viewed payload from another project even when its revision id matches', () => {
    const approved = approvedRevision();
    const error = vi.fn();
    service.getApprovedRevision(approved, { ...approved, project: 'other-project' }).subscribe({ error });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'The approved current changed. Reload and try again.' }));
    http.expectNone(() => true);
  });

  it('fetches approved current separately from a newer viewed draft', () => {
    const approved = approvedRevision();
    const draft = { ...approved, revision: { ...approved.revision, id: `000003-${'b'.repeat(64)}`, approval: null, latest: false } };
    const next = vi.fn();
    service.getApprovedRevision(draft, draft).subscribe(next);
    const request = http.expectOne((candidate) => candidate.url.endsWith(`/revisions/${REVISION_ID}`));
    expect(request.request.params.get('project')).toBe('proj-1');
    request.flush(approved);
    expect(next).toHaveBeenCalledWith(approved);
  });

  it.each(['project', 'document', 'agent', 'revision', 'selection', 'approval'])('rejects a stale or mismatched approved payload (%s)', (fault) => {
    const detail = approvedRevision();
    const invalid = approvedRevision();
    switch (fault) {
      case 'project':
        invalid.project = 'other-project';
        break;
      case 'document':
        invalid.documentId = 'other-document';
        break;
      case 'agent':
        invalid.type = { ...invalid.type, agentKey: 'brand-kit' };
        break;
      case 'revision':
        invalid.revision = { ...invalid.revision, id: `000003-${'b'.repeat(64)}` };
        break;
      case 'selection':
        invalid.approvedCurrent = null;
        break;
      case 'approval':
        invalid.revision = { ...invalid.revision, approval: null };
        break;
    }
    const error = vi.fn();
    service.getApprovedRevision(detail).subscribe({ error });
    http.expectOne((candidate) => candidate.url.endsWith(`/revisions/${REVISION_ID}`)).flush(invalid);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'The approved current changed. Reload and try again.' }));
  });

  it('POSTs approval with the project query and encoded revision path', () => {
    service.approveRevision('proj-1', 'faq', 'living', REVISION_ID).subscribe();
    const request = http.expectOne((candidate) => candidate.url === `/api/mktg-agents/documents/faq/living/revisions/${REVISION_ID}/approve`);
    expect(request.request.method).toBe('POST');
    expect(request.request.params.get('project')).toBe('proj-1');
    expect(request.request.body).toEqual({});
    request.flush({});
  });

  it('PATCHes only the run presentation link and project, not a revision or agent request', () => {
    service.saveLinkedinShareLink('proj-1', 'run-example', 'https://public.example/new').subscribe();
    const request = http.expectOne('/api/mktg-agents/linkedin-post/documents/run-example/share-link');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ project: 'proj-1', share_link: 'https://public.example/new' });
    request.flush({ share_link: 'https://public.example/new' });
  });

  it('POSTs a restore with the project and the revision id in the body', () => {
    service.restoreRevision('proj-1', 'icp', 'living', REVISION_ID).subscribe();

    const request = http.expectOne('/api/mktg-agents/documents/icp/living/restore');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ project: 'proj-1', revisionId: REVISION_ID });
    request.flush({});
  });

  it('marks timer reads explicitly and keeps failure-detail refresh scoped to an explicit navigation', () => {
    service.listDocuments('proj-1', true).subscribe();
    service.getDocument('proj-1', 'brand-kit', 'living', true).subscribe();
    service.getRevision('proj-1', 'brand-kit', 'living', REVISION_ID, true).subscribe();
    const timers = http.match(() => true);
    expect(timers).toHaveLength(3);
    for (const request of timers) {
      expect(request.request.params.get('poll')).toBe('1');
      expect(request.request.params.has('refreshRun')).toBe(false);
      request.flush({});
    }
    const id = 'b'.repeat(64);
    service.getDocument('proj-1', 'brand-kit', 'living', false, id).subscribe();
    const refresh = http.expectOne((request) => request.params.get('refreshRun') === id);
    expect(refresh.request.params.has('poll')).toBe(false);
    refresh.flush({});
  });

  it('retries the exact recorded run without a Generate or Restore request', () => {
    const id = 'b'.repeat(64);
    service.retryRun('proj-1', 'brand-kit', 'living', id).subscribe();
    const retry = http.expectOne(`/api/mktg-agents/documents/brand-kit/living/runs/${id}/retry`);
    expect(retry.request.method).toBe('POST');
    expect(retry.request.body).toEqual({ project: 'proj-1' });
    retry.flush({});
  });

  it.each([true, false])('rethrows a document 404 but logs it only when expectedPending is false (%s)', (expectedPending) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = vi.fn();
    try {
      service.getDocument('proj-1', 'aeo-geo', 'run-012345678901234567890123', false, undefined, expectedPending).subscribe({ error });
      http.expectOne((request) => request.url.endsWith('/run-012345678901234567890123')).flush('missing', { status: 404, statusText: 'Not Found' });
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
      if (expectedPending) {
        expect(consoleError).not.toHaveBeenCalled();
      } else {
        expect(consoleError).toHaveBeenCalledWith('Failed to load a Marketing OS document', expect.objectContaining({ status: 404 }));
      }
    } finally {
      consoleError.mockRestore();
    }
  });
  it('keeps logging non-404 failures even for a matching pending document', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = vi.fn();
    try {
      service.getDocument('proj-1', 'aeo-geo', 'run-012345678901234567890123', false, undefined, true).subscribe({ error });
      http.expectOne((request) => request.url.endsWith('/run-012345678901234567890123')).flush('unavailable', { status: 503, statusText: 'Unavailable' });
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));
      expect(consoleError).toHaveBeenCalledWith('Failed to load a Marketing OS document', expect.objectContaining({ status: 503 }));
    } finally {
      consoleError.mockRestore();
    }
  });
  it('logs only status and code, never the private error response', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      service.listDocuments('proj-1').subscribe({ error: () => undefined });
      http
        .expectOne((request) => request.url === '/api/mktg-agents/documents')
        .flush({ code: 'RUN_ALREADY_STARTED', startedBy: 'synthetic-person@example.test', details: 'private reply' }, { status: 409, statusText: 'Conflict' });
      expect(consoleError).toHaveBeenCalledWith('Failed to load Marketing OS documents', { status: 409, code: 'RUN_ALREADY_STARTED' });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('synthetic-person');
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private reply');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('logs and rethrows a failed read, so it never reads as "no documents yet"', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const next = vi.fn();
    const error = vi.fn();

    service.listDocuments('proj-1').subscribe({ next, error });
    http.expectOne((candidate) => candidate.url === '/api/mktg-agents/documents').flush('boom', { status: 500, statusText: 'Server Error' });

    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
    expect(consoleError).toHaveBeenCalledWith('Failed to load Marketing OS documents', expect.objectContaining({ status: 500 }));
    consoleError.mockRestore();
  });
});
