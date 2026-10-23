// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Member360Service } from './member-360.service';

describe('Member360Service dedicated transports', () => {
  let api: Member360Service;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(Member360Service);
    http = TestBed.inject(HttpTestingController);
    sessionStorage.clear();
  });
  afterEach(() => http.verify());

  it('returns the accepted destination and durable run selector without storing a pending browser capability', () => {
    const session = { sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567', runId: 'a'.repeat(64) };
    let received: unknown;
    api.generate({ project: 'sample-project' }).subscribe((result) => {
      received = result;
    });
    const request = http.expectOne('/api/mktg-agents/member-360/generate');
    expect(request.request.body).toEqual({ project: 'sample-project' });
    request.flush(session);
    expect(received).toEqual(session);
    expect(sessionStorage.length).toBe(0);
    http.expectNone('/api/mktg-agents/member-360/result');
  });

  it('passes URI-encoded tracker filenames in the upload header, never the URL', () => {
    const filename = 'Q3+sponsors — draft.csv';
    api.parseTracker('sample-project', new File(['company\nSample Org'], filename)).subscribe();
    const request = http.expectOne('/api/mktg-agents/member-360/tracker?project=sample-project');
    expect(request.request.headers.get('X-File-Name')).toBe(encodeURIComponent(filename));
    expect(request.request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(request.request.body).toBeInstanceOf(File);
    expect(request.request.urlWithParams).not.toContain('filename');
    request.flush({ filename, rows: [{ company: 'Sample Org' }] });
  });

  it('downloads a stored document through the BFF without sending client tabs', () => {
    const blob = new Blob(['synthetic workbook']);
    let received: Blob | undefined;
    api.download('sample-project', 'run-0123456789abcdef01234567').subscribe((value) => {
      received = value;
    });
    const request = http.expectOne('/api/mktg-agents/member-360/documents/run-0123456789abcdef01234567/workbook?project=sample-project');
    expect(request.request.method).toBe('GET');
    expect(request.request.body).toBeNull();
    expect(request.request.responseType).toBe('blob');
    request.flush(blob);
    expect(received).toBe(blob);
  });
});
