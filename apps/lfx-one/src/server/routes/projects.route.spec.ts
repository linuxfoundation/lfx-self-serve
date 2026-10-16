// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { gate, getProjectBySlug, getSummary, getList, getOrgLensLinks, exportCsv } = vi.hoisted(() => ({
  gate: vi.fn(),
  getProjectBySlug: vi.fn((_req: unknown, res: Response) => res.json({ handler: 'project' })),
  getSummary: vi.fn((_req: unknown, res: Response) => res.json({ handler: 'summary' })),
  getList: vi.fn((_req: unknown, res: Response) => res.json({ handler: 'list' })),
  getOrgLensLinks: vi.fn((_req: unknown, res: Response) => res.json({ handler: 'org-lens-links' })),
  exportCsv: vi.fn((_req: unknown, res: Response) => res.json({ handler: 'export' })),
}));

vi.mock('../controllers/project.controller', () => ({
  ProjectController: class {
    public getProjectBySlug = getProjectBySlug;
  },
}));
vi.mock('../controllers/project-participating-orgs.controller', () => ({
  ProjectParticipatingOrgsController: class {
    public getSummary = getSummary;
    public getList = getList;
    public getOrgLensLinks = getOrgLensLinks;
    public export = exportCsv;
  },
}));
vi.mock('../middleware/require-project-participating-orgs-access.middleware', () => ({
  requireProjectParticipatingOrgsAccess: gate,
}));

import router from './projects.route';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use('/api/projects', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

const PATHS = [
  ['/synthetic-project/participating-orgs/summary', 'summary'],
  ['/synthetic-project/participating-orgs/export', 'export'],
  ['/synthetic-project/participating-orgs/org-lens-links', 'org-lens-links'],
  ['/synthetic-project/participating-orgs', 'list'],
] as const;

describe('participating-orgs routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(PATHS)('%s never reaches its handler when the gate denies', async (path) => {
    gate.mockImplementation((_req: Request, res: Response) => res.status(403).json({ denied: true }));

    const response = await fetch(`${baseUrl}/api/projects${path}`);

    expect(response.status).toBe(403);
    expect(gate).toHaveBeenCalledOnce();
    expect(getSummary).not.toHaveBeenCalled();
    expect(getList).not.toHaveBeenCalled();
    expect(getOrgLensLinks).not.toHaveBeenCalled();
    expect(exportCsv).not.toHaveBeenCalled();
  });

  it.each(PATHS)('%s reaches its own handler, not /:slug, once the gate passes', async (path, handler) => {
    gate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());

    const response = await fetch(`${baseUrl}/api/projects${path}`);

    expect(await response.json()).toEqual({ handler });
    expect(getProjectBySlug).not.toHaveBeenCalled();
  });
});
