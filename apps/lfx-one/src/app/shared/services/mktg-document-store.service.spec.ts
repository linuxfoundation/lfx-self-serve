// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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

  it('POSTs a restore with the project and the revision id in the body', () => {
    service.restoreRevision('proj-1', 'icp', 'living', REVISION_ID).subscribe();

    const request = http.expectOne('/api/mktg-agents/documents/icp/living/restore');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ project: 'proj-1', revisionId: REVISION_ID });
    request.flush({});
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
