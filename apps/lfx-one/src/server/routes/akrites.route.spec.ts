// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The authorization middleware's transitive imports include partially compiled Angular code,
// which needs the JIT compiler when these server-only tests run under Vitest.
import '@angular/compiler';

import express from 'express';
import { request as nodeRequest, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getPersonas = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas },
}));

vi.mock('../services/logger.service', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
    info: vi.fn(),
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

const akritesRouter = (await import('./akrites.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

interface TestResponse {
  status: number;
  body: unknown;
}

interface StewardshipWriteRoute {
  label: string;
  method: 'POST' | 'PUT';
  path: string;
  body: Record<string, unknown>;
  cdpMethod: 'POST' | 'PATCH';
}

const actor = {
  userId: 'ed-user-id',
  username: 'ed-user',
  displayName: 'Executive Director',
  avatarUrl: null,
};

const stewardshipWriteRoutes: readonly StewardshipWriteRoute[] = [
  {
    label: 'opens a stewardship',
    method: 'POST',
    path: '/stewardships',
    body: { purl: 'pkg:npm/example', actor },
    cdpMethod: 'POST',
  },
  {
    label: 'assigns a steward',
    method: 'PUT',
    path: '/stewardships/42/steward',
    body: {
      steward: { userId: 'steward-user-id', username: 'steward-user', displayName: 'Steward User', role: 'lead' },
      actor,
    },
    cdpMethod: 'POST',
  },
  {
    label: 'escalates a stewardship',
    method: 'PUT',
    path: '/stewardships/42/escalate',
    body: { resolutionPath: 'right_of_first_refusal', actor },
    cdpMethod: 'POST',
  },
  {
    label: 'updates stewardship status',
    method: 'PUT',
    path: '/stewardships/42/status',
    body: { status: 'active', actor },
    cdpMethod: 'PATCH',
  },
];

let server: Server;
let baseUrl: string;
let previousCdpAccessToken: string | undefined;

function sendRequest(route: StewardshipWriteRoute): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const req = nodeRequest(
      `${baseUrl}${route.path}`,
      {
        method: route.method,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: responseBody ? (JSON.parse(responseBody) as unknown) : null,
          });
        });
      }
    );

    req.on('error', reject);
    req.end(JSON.stringify(route.body));
  });
}

function successfulCdpResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ stewardship: { id: 42 } }),
  } as Response;
}

beforeAll(async () => {
  previousCdpAccessToken = process.env['CDP_ACCESS_TOKEN'];
  process.env['CDP_ACCESS_TOKEN'] = 'test-cdp-access-token';
  vi.spyOn(globalThis, 'fetch');

  const app = express();
  app.use(express.json());
  app.use('/api/akrites', akritesRouter);
  app.use(apiErrorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/akrites`;
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (previousCdpAccessToken === undefined) {
    delete process.env['CDP_ACCESS_TOKEN'];
  } else {
    process.env['CDP_ACCESS_TOKEN'] = previousCdpAccessToken;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  getPersonas.mockResolvedValue({
    personas: ['executive-director'],
    personaProjects: {},
    isRootWriter: false,
    isLFStaff: false,
  });
  vi.mocked(globalThis.fetch).mockResolvedValue(successfulCdpResponse());
});

describe('Akrites stewardship write routes', () => {
  it.each(stewardshipWriteRoutes)('allows an Executive Director to $label', async (route) => {
    const response = await sendRequest(route);

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/akrites/stewardships/'),
      expect.objectContaining({
        method: route.cdpMethod,
        headers: expect.objectContaining({ Authorization: 'Bearer test-cdp-access-token' }),
      })
    );
  });

  it.each(stewardshipWriteRoutes)('returns 403 and does not call CDP when an authenticated non-ED user $label', async (route) => {
    getPersonas.mockResolvedValue({
      personas: ['contributor'],
      personaProjects: {},
      isRootWriter: false,
      isLFStaff: false,
    });

    const response = await sendRequest(route);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'EXECUTIVE_DIRECTOR_REQUIRED' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
