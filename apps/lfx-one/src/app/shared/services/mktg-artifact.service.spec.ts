// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE } from '@lfx-one/shared/constants';
import { MktgArtifactStoredResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MktgArtifactService } from './mktg-artifact.service';

/**
 * The shared stored-artifact read client is a thin HTTP wrapper; what matters
 * is the contract the BFF's `stored` endpoints expect — GET, the endpoint as
 * REGISTERED (never rewritten), the project uid as the `project` query param
 * — and that an error passes through untouched, because the dependency
 * resolver's "any error means no server copy" fallback relies on it.
 */
describe('MktgArtifactService', () => {
  const storedResponse: MktgArtifactStoredResponse = {
    documentMarkdown: '# Server kit',
    receipt: { s3_key: 'marketing/proj-1/brand-kit/v4.md', content_sha256: 'abc123', project: 'proj-1', version: 4, intake_mode: 'form' },
  };

  let service: MktgArtifactService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MktgArtifactService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('GETs the registered stored endpoint with the project uid as the `project` query param', () => {
    const endpoint = BRAND_KIT_INTAKE.endpoints.stored as string;
    let received: MktgArtifactStoredResponse | undefined;

    service.getStored(endpoint, 'proj-1').subscribe((response) => (received = response));

    const req = http.expectOne((request) => request.url === endpoint);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('project')).toBe('proj-1');
    expect(req.request.urlWithParams).toBe(`${endpoint}?project=proj-1`);
    req.flush(storedResponse);
    expect(received).toEqual(storedResponse);
  });

  it('uses the endpoint it is GIVEN — a different agent hits its own stored URL, nothing is rewritten', () => {
    const endpoint = FOUNDATION_MESSAGE_INTAKE.endpoints.stored as string;

    service.getStored(endpoint, 'proj-1').subscribe();

    const req = http.expectOne((request) => request.url === endpoint);
    expect(req.request.urlWithParams).toBe(`${endpoint}?project=proj-1`);
    req.flush(storedResponse);
  });

  it('URL-encodes the project uid rather than letting it alter the query', () => {
    const endpoint = BRAND_KIT_INTAKE.endpoints.stored as string;

    service.getStored(endpoint, 'proj 1&x=y').subscribe();

    const req = http.expectOne((request) => request.url === endpoint);
    expect(req.request.params.get('project')).toBe('proj 1&x=y');
    expect(req.request.urlWithParams).toBe(`${endpoint}?project=proj%201%26x=y`);
    req.flush(storedResponse);
  });

  it('propagates a 404 as an error — the caller decides that means "no server copy"', () => {
    const endpoint = BRAND_KIT_INTAKE.endpoints.stored as string;
    let status: number | undefined;

    service.getStored(endpoint, 'proj-1').subscribe({ error: (err) => (status = err.status) });

    http.expectOne((request) => request.url === endpoint).flush({ message: 'Not found' }, { status: 404, statusText: 'Not Found' });
    expect(status).toBe(404);
  });
});
