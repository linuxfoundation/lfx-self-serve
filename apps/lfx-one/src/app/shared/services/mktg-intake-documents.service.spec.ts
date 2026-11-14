// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FOUNDATION_MESSAGE_FILE_NAME_HEADER, FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE, FOUNDATION_MESSAGE_INTAKE } from '@lfx-one/shared/constants';
import { MktgDocumentExtractResponse, MktgIntakeDocumentsConfig } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MktgIntakeDocumentsService } from './mktg-intake-documents.service';

/**
 * The browser never parses a document: a file goes to the BFF as its raw
 * bytes, with its name URI-encoded in a header (never the URL, which the
 * request logger writes). A link is never read here — the agent fetches it —
 * so the service has no link call. These pin that wire contract against the
 * endpoint the intake config names.
 */
describe('MktgIntakeDocumentsService', () => {
  const config = FOUNDATION_MESSAGE_INTAKE.documents as MktgIntakeDocumentsConfig;
  const read: MktgDocumentExtractResponse = { title: 'notes.md', read: true, words: 2, truncated: false, text: '# Notes' };

  let service: MktgIntakeDocumentsService;
  let http: HttpTestingController;

  /** `readFile` reads the file's bytes (a promise) before it posts; let that settle. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MktgIntakeDocumentsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MktgIntakeDocumentsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts a file as its raw bytes, typed octet-stream, with the URI-encoded name in a header', async () => {
    let response: MktgDocumentExtractResponse | undefined;
    service.readFile(config, new File(['# Notes'], 'Q3 plan — draft.md')).subscribe((value) => (response = value));
    await settle();

    const request = http.expectOne(config.endpoints.file);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Content-Type')).toBe(FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE);
    expect(request.request.headers.get(FOUNDATION_MESSAGE_FILE_NAME_HEADER)).toBe(encodeURIComponent('Q3 plan — draft.md'));
    expect(request.request.url).not.toContain('Q3');
    expect(new TextDecoder().decode(request.request.body as ArrayBuffer)).toBe('# Notes');

    request.flush(read);
    expect(response).toEqual(read);
  });

  it('passes a server error on to the caller instead of swallowing it', async () => {
    let failure: HttpErrorResponse | undefined;
    service.readFile(config, new File(['x'], 'brief.docx')).subscribe({ error: (error: HttpErrorResponse) => (failure = error) });
    await settle();

    http.expectOne(config.endpoints.file).flush({ message: 'too large' }, { status: 413, statusText: 'Payload Too Large' });

    expect(failure?.status).toBe(413);
  });

  it('reads no links — the intake names a file endpoint only, and the agent fetches links itself', () => {
    expect(Object.keys(config.endpoints)).toEqual(['file']);
    expect((service as unknown as Record<string, unknown>)['readLink']).toBeUndefined();
  });
});
