// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as analytics.route.spec.ts: the import graph reaches Angular's partially-compiled @angular/common.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

/**
 * Router-level coverage for the Participating Companies gates (#5697): the dark-launch flag answers a neutral 404 before
 * any access check, `requireDashboardAccess` admits only the executive director of the named foundation or LF staff, and
 * the controller refuses a missing, repeated or malformed `foundationSlug` and bad filters. Real HTTP requests go through
 * the assembled router, so dropping or reordering a middleware registration fails here.
 */

const getPersonas = vi.fn();
const checkProjectWriter = vi.fn();

// The warehouse source is replaced by one fixed foundation; the gates under test sit in front of it.
vi.mock('../services/foundation-participating-orgs.snowflake-source', () => ({
  FoundationParticipatingOrgsSnowflakeSource: class {
    public async getFoundation(slug: string) {
      return {
        slug,
        name: 'Synthetic Foundation',
        asOfDate: '2026-11-01',
        projects: [],
        companies: [
          {
            key: 'synthetic-company',
            accountId: null,
            name: 'Synthetic Company',
            logoUrl: null,
            isMember: false,
            tier: null,
            otherMemberships: [],
            projectsInvolved: 1,
            commits: 3,
            commitsChange: null,
            contributors: 1,
            contributorsChange: null,
          },
        ],
      };
    }
    public async getProjectLines() {
      return [];
    }
  },
}));
vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas, checkProjectWriter },
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
    getLastOperation: vi.fn(),
  },
}));

const router = (await import('./foundation-participating-orgs.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/foundation-participating-orgs', router);
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env[ServerFeatureFlag.FoundationParticipatingOrgs] = 'true';
  checkProjectWriter.mockResolvedValue(false);
  getPersonas.mockResolvedValue({ personas: ['contributor'], isLFStaff: false, isRootWriter: false, personaProjects: {} });
});

afterEach(() => {
  delete process.env[ServerFeatureFlag.FoundationParticipatingOrgs];
});

function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}/api/foundation-participating-orgs${path}`);
}

function asExecutiveDirectorOf(slug: string): void {
  getPersonas.mockResolvedValue({
    personas: ['executive-director'],
    isLFStaff: false,
    isRootWriter: false,
    personaProjects: { 'executive-director': [{ projectSlug: slug }] },
  });
}

describe('dark launch', () => {
  it('answers a neutral 404 on every route before any access check when the flag is off', async () => {
    delete process.env[ServerFeatureFlag.FoundationParticipatingOrgs];
    for (const path of ['', '/summary', '/projects', '/breakdown', '/export']) {
      const response = await get(`${path}?foundationSlug=synthetic-foundation`);
      expect(response.status).toBe(404);
    }
    expect(getPersonas).not.toHaveBeenCalled();
  });
});

describe('access', () => {
  it('refuses a caller who is neither an executive director nor LF staff', async () => {
    expect((await get('/summary?foundationSlug=synthetic-foundation')).status).toBe(403);
  });

  it('refuses an executive director of another foundation', async () => {
    asExecutiveDirectorOf('another-foundation');
    expect((await get('/summary?foundationSlug=synthetic-foundation')).status).toBe(403);
  });

  it('admits the executive director of the named foundation', async () => {
    asExecutiveDirectorOf('synthetic-foundation');
    const response = await get('/summary?foundationSlug=synthetic-foundation');
    expect(response.status).toBe(200);
    expect((await response.json()).summary).toMatchObject({ foundationSlug: 'synthetic-foundation', companiesCount: 1, asOfDate: '2026-11-01' });
  });

  it('admits LF staff for any foundation', async () => {
    getPersonas.mockResolvedValue({ personas: ['contributor'], isLFStaff: true, isRootWriter: false, personaProjects: {} });
    expect((await get('?foundationSlug=another-foundation')).status).toBe(200);
  });
});

describe('input validation', () => {
  beforeEach(() => asExecutiveDirectorOf('synthetic-foundation'));

  it.each([
    ['a missing foundationSlug', '/summary'],
    ['a repeated foundationSlug', '/summary?foundationSlug=synthetic-foundation&foundationSlug=another-foundation'],
    ['an unknown range', '/summary?foundationSlug=synthetic-foundation&range=forever'],
    ['an unknown tier', '?foundationSlug=synthetic-foundation&tier=Diamond'],
    ['an unknown segment', '?foundationSlug=synthetic-foundation&segment=everyone'],
    ['an unknown export kind', '/export?foundationSlug=synthetic-foundation&kind=everything'],
    ['a blank companyKey', '/breakdown?foundationSlug=synthetic-foundation&companyKey=%20'],
  ])('answers 400 for %s', async (_name, path) => {
    expect((await get(path)).status).toBe(400);
  });

  it('answers 400 for a malformed foundationSlug once access is admitted (LF staff), and 403 for a scoped executive director', async () => {
    expect((await get('/summary?foundationSlug=Not%20A%20Slug')).status).toBe(403);
    getPersonas.mockResolvedValue({ personas: ['contributor'], isLFStaff: true, isRootWriter: false, personaProjects: {} });
    expect((await get('/summary?foundationSlug=Not%20A%20Slug')).status).toBe(400);
  });

  it('answers 404 for a project that is not in the foundation', async () => {
    expect((await get('?foundationSlug=synthetic-foundation&projectSlug=no-such-project')).status).toBe(404);
  });

  it('serves a CSV for the by-project export', async () => {
    const response = await get('/export?foundationSlug=synthetic-foundation&kind=by-project');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(await response.text()).toContain('Share of company commits');
  });
});
