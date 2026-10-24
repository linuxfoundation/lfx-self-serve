// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { MicroserviceError } from '../errors';

const fake = vi.hoisted(() => ({ construct: vi.fn(), read: vi.fn() }));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public constructor() {
      fake.construct();
    }
    public async getProjectById() {
      return { uid: 'synthetic-project', writer: true };
    }
  },
}));
vi.mock('../services/mktg-access.service', () => ({
  MktgAccessService: class {
    public read = fake.read;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: vi.fn(), success: vi.fn() } }));
vi.mock('../controllers/mktg-slides-export.controller', () => ({ MktgSlidesExportController: class {} }));
vi.mock('../controllers/mktg-agents.controller', () => ({ MktgAgentsController: class {} }));
vi.mock('../controllers/member-360.controller', () => ({ Member360Controller: class {} }));
vi.mock('../controllers/member-360-workbook.controller', () => ({ Member360WorkbookController: class {} }));
vi.mock('../controllers/mktg-documents.controller', () => ({ MktgDocumentsController: class {} }));

import router from './mktg-agents.route';

describe('Marketing Access route', () => {
  it('constructs its lazy controller once for concurrent and repeated GETs, forwarding rejection', async () => {
    const route = router.stack.find((entry) => entry.route?.path === '/access')?.route;
    expect(route?.stack.map((entry) => entry.method)).toEqual(['get']);
    const handler = route?.stack[0]?.handle;
    expect(handler).toBeDefined();
    if (!handler) return;
    const req = { query: { project: 'synthetic-project' } } as unknown as Request;
    const res = { json: vi.fn() } as unknown as Response;
    const next = vi.fn();
    expect(fake.construct).not.toHaveBeenCalled();
    fake.read.mockResolvedValue({ writers: [], executiveDirector: null, tocChair: null, warnings: [] });
    handler(req, res, next);
    handler(req, res, next);
    await vi.waitFor(() => expect(fake.read).toHaveBeenCalledTimes(2));
    expect(fake.construct).toHaveBeenCalledOnce();
    expect(fake.read).toHaveBeenCalledWith(req, 'synthetic-project');
    expect(res.json).toHaveBeenCalledTimes(2);
    const failure = new MicroserviceError('Synthetic outage', 503, 'SYNTHETIC_OUTAGE');
    fake.read.mockRejectedValueOnce(failure);
    handler(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledExactlyOnceWith(failure));
    expect(fake.construct).toHaveBeenCalledOnce();
  });
});
