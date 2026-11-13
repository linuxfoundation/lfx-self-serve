// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import type { SocialListeningFeedRequest, SocialListeningMention } from '@lfx-one/shared/interfaces';
import express from 'express';
import type { Server } from 'node:http';
import { firstValueFrom, from } from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectContextService } from '../../app/shared/services/project-context.service';
import { SocialListeningService as AngularSocialListeningService } from '../../app/shared/services/social-listening.service';

const { execute, getPersonas, checkProjectWriter, upsertPreference, deletePreference } = vi.hoisted(() => ({
  execute: vi.fn(),
  getPersonas: vi.fn(),
  checkProjectWriter: vi.fn(),
  upsertPreference: vi.fn(),
  deletePreference: vi.fn(),
}));

// The real ProjectContextService pulls in browser-only modules; the gateway only needs its token.
vi.mock('../../app/shared/services/project-context.service', () => ({ ProjectContextService: class {} }));
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { getPersonas, checkProjectWriter } }));
vi.mock('../services/snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('../services/valkey.service', () => ({
  withSocialListeningCache: (_slug: string, _resource: string, _discriminator: unknown[], _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
}));
vi.mock('../services/user-preference.service', () => ({
  UserPreferenceService: class {
    public upsertPreference = upsertPreference;
    public deletePreference = deletePreference;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    getLastOperation: vi.fn(),
  },
}));

const router = (await import('./social-listening.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;
let gateway: AngularSocialListeningService;
const received: { method: string; url: string; body: Record<string, unknown> | undefined }[] = [];

beforeAll(async () => {
  const app = express();
  // Match the existing production parser; do not raise Node's default request-header limit.
  app.use(express.json({ limit: '15mb' }));
  app.use((req, _res, next) => {
    req.impersonationActive = req.header('x-test-impersonating') === 'true';
    received.push({ method: req.method, url: req.originalUrl, body: req.body });
    next();
  });
  app.use('/api/social-listening', router);
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an ephemeral HTTP port');
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Only the browser's network backend is replaced: the gateway and HttpClient construct and
  // serialize their own real requests, which cross HTTP into the real router/controller/service.
  const http = new HttpClient({
    handle: (request) =>
      from(
        (async () => {
          const contentType = request.detectContentTypeHeader();
          const response = await fetch(`${baseUrl}${request.urlWithParams}`, {
            method: request.method,
            headers: contentType ? { 'Content-Type': contentType } : undefined,
            body: request.serializeBody(),
          });
          const body = await response.json();
          if (!response.ok) throw new HttpErrorResponse({ status: response.status, error: body, url: request.urlWithParams });
          return new HttpResponse({ status: response.status, body, url: request.urlWithParams });
        })()
      ),
  });
  const injector = Injector.create({
    providers: [
      { provide: HttpClient, useValue: http },
      // The gateway scopes preference calls to the selected foundation (lfx-self-serve-ops#387).
      { provide: ProjectContextService, useValue: { selectedFoundation: () => ({ slug: 'synthetic-owned' }) } },
    ],
  });
  gateway = runInInjectionContext(injector, () => new AngularSocialListeningService());
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(() => {
  vi.resetAllMocks();
  received.length = 0;
  getPersonas.mockResolvedValue({
    personas: ['executive-director'],
    personaProjects: { 'executive-director': [{ projectSlug: 'synthetic-owned' }] },
    isRootWriter: false,
    isLFStaff: false,
  });
  execute.mockResolvedValue({ rows: [] });
});

function mention(id: string, timestamp: string | null): SocialListeningMention {
  return {
    MENTION_ID: id,
    PROJECT_ID: 'synthetic-project',
    PROJECT_NAME: 'Synthetic Foundation',
    PROJECT_SLUG: 'synthetic-owned',
    SOURCE_PROJECT_ID: 'synthetic-child',
    SOURCE_PROJECT_NAME: 'Synthetic Child',
    TITLE: null,
    BODY: null,
    AUTHOR: null,
    AUTHOR_PROFILE_LINK: null,
    SOURCE_PLATFORM: 'reddit',
    SOCIAL_NETWORK: 'reddit',
    SENTIMENT: null,
    RELEVANCE_SCORE: null,
    RELEVANCE_COMMENT: null,
    URL: null,
    IMAGE_URL: null,
    SUBREDDIT: null,
    VIEW_NAME: 'synthetic-feed',
    MENTION_TS: timestamp,
    KEYWORD: null,
    LANGUAGE: null,
    TAGS: null,
    COMPUTED_AT: '2026-01-16T00:00:00Z',
  };
}

async function post(path: string, body: unknown, impersonating = false): Promise<Response> {
  return fetch(`${baseUrl}/api/social-listening${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-impersonating': String(impersonating) },
    body: JSON.stringify(body),
  });
}

describe('Social Listening JSON read transport', () => {
  it('opens and pages the real gateway feed and count with all 500+500 opaque overrides intact', async () => {
    const readIds = Array.from({ length: 500 }, (_, index) => `Read-${index},+/=`.padEnd(200, 'x'));
    const unreadIds = Array.from({ length: 500 }, (_, index) => `Unread-${index},+/=`.padEnd(200, 'y'));
    const request: SocialListeningFeedRequest = {
      foundationSlug: 'Synthetic-Owned',
      period: '2026-01',
      unreadOnly: true,
      readIds,
      unreadIds,
      readBeforeTs: '2026-01-15 10:00:00.123',
      page_size: 2,
    };
    expect(Buffer.byteLength(JSON.stringify(request))).toBeGreaterThan(200_000);
    const cursorRow = mention('Opaque-Cursor,+/=', null);
    const lastRow = mention('last-mention', '2026-01-16 10:00:00');
    execute.mockResolvedValueOnce({ rows: [mention('first-mention', null), cursorRow, lastRow] });
    const first = await firstValueFrom(gateway.getMentionsFeed(request));
    expect(first.mentions.map((row) => row.MENTION_ID)).toEqual(['first-mention', cursorRow.MENTION_ID]);
    expect(first.computedAt).toBe('2026-01-16T00:00:00Z');
    expect(first.page_token).toBeTypeOf('string');
    expect(execute.mock.calls[0][1]).toEqual(expect.arrayContaining(['synthetic-owned', ...readIds, ...unreadIds, request.readBeforeTs]));

    execute.mockResolvedValueOnce({ rows: [lastRow] });
    const second = await firstValueFrom(gateway.getMentionsFeed({ ...request, page_token: first.page_token }));
    expect(second.mentions).toEqual([lastRow]);
    expect(second.page_token).toBeUndefined();
    expect(execute.mock.calls[1][1].at(-1)).toBe(cursorRow.MENTION_ID);

    execute.mockResolvedValueOnce({ rows: [{ TOTAL: 3 }] });
    const countRequest = { ...request };
    delete countRequest.page_size;
    expect(await firstValueFrom(gateway.getMentionsCount(countRequest))).toEqual({ total: 3 });
    expect(execute.mock.calls[2][1]).toEqual(expect.arrayContaining(['synthetic-owned', ...readIds, ...unreadIds, request.readBeforeTs]));
    expect(received.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'POST', url: '/api/social-listening/mentions-feed' },
      { method: 'POST', url: '/api/social-listening/mentions-feed' },
      { method: 'POST', url: '/api/social-listening/mentions-count' },
    ]);
    for (const { body } of received) expect(body).toMatchObject({ readIds, unreadIds, unreadOnly: true, readBeforeTs: request.readBeforeTs });
    expect(received[1].body?.['page_token']).toBe(first.page_token);
  });

  it.each(['/mentions-feed', '/mentions-count'])('denies foreign body scope despite an owned query on %s', async (path) => {
    const response = await post(`${path}?foundationSlug=synthetic-owned`, { foundationSlug: 'synthetic-foreign' });
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['/mentions-feed', '/mentions-count'])('rejects malformed bodies before SQL on %s', async (path) => {
    for (const body of [{}, { foundationSlug: 'synthetic-owned', readIds: ['valid', 42] }, { foundationSlug: 'synthetic-owned', unreadOnly: 'true' }]) {
      const response = await post(path, body);
      expect(response.status).toBe(400);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['/mentions-feed', '/mentions-count'])('returns 400 for primitive and invalid JSON before data access on %s', async (path) => {
    for (const body of ['null', '"synthetic-private-body"', '42', 'true', '{"synthetic-private-body":']) {
      const response = await fetch(`${baseUrl}/api/social-listening${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR', errors: [{ field: 'body' }] });
    }
    expect(execute).not.toHaveBeenCalled();
    expect(getPersonas).not.toHaveBeenCalled();
  });

  it('rejects oversized feed cursors with 400 before SQL', async () => {
    const cursors = [
      { ts: null, key: 'x'.repeat(201) },
      { ts: null, key: 'synthetic-key', padding: 'x'.repeat(4000) },
    ];
    for (const cursor of cursors) {
      const pageToken = Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
      const response = await post('/mentions-feed', { foundationSlug: 'synthetic-owned', page_token: pageToken });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR', errors: [{ field: 'page_token' }] });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves authorized impersonated POST reads while blocking both preference writes', async () => {
    expect((await post('/mentions-feed', { foundationSlug: 'synthetic-owned' }, true)).status).toBe(200);
    execute.mockResolvedValueOnce({ rows: [{ TOTAL: 0 }] });
    const count = await post('/mentions-count', { foundationSlug: 'synthetic-owned' }, true);
    expect(count.status).toBe(200);
    expect(await count.json()).toEqual({ total: 0 });
    const name = encodeURIComponent('Social Listening Read State - a0eeb0a1-0000-0000-0000-000000000001');
    for (const method of ['PUT', 'DELETE']) {
      const response = await fetch(`${baseUrl}/api/social-listening/preferences/${name}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-test-impersonating': 'true' },
        ...(method === 'PUT' ? { body: JSON.stringify({ value: '{}' }) } : {}),
      });
      expect(response.status).toBe(403);
    }
    expect(upsertPreference).not.toHaveBeenCalled();
    expect(deletePreference).not.toHaveBeenCalled();
  });

  it('keeps GET options authorized by query scope and removes legacy feed/count GETs', async () => {
    expect(await firstValueFrom(gateway.getMentionsProjects({ foundationSlug: 'synthetic-owned' }))).toEqual([]);
    await expect(firstValueFrom(gateway.getMentionsProjects({ foundationSlug: 'synthetic-foreign' }))).rejects.toMatchObject({ status: 403 });
    for (const path of ['/mentions-feed', '/mentions-count']) {
      expect((await fetch(`${baseUrl}/api/social-listening${path}?foundationSlug=synthetic-owned`)).status).toBe(404);
    }
  });
});
