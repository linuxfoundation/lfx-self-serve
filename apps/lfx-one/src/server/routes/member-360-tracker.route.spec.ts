// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const objects = vi.hoisted(() => new Map<string, string>());
const parseTracker = vi.hoisted(() =>
  vi.fn((_req: express.Request, res: express.Response) => {
    objects.set('private-tracker', 'synthetic parsed rows');
    res.json({ parsed: true });
  })
);
const deleteTracker = vi.hoisted(() =>
  vi.fn((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = String(req.params['id']);
    const creator = objects.get(id);
    if (creator && creator !== req.headers['x-test-creator']) return next(new ResourceNotFoundError('Member 360 tracker'));
    objects.delete(id);
    res.status(204).end();
  })
);
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/foundation-message.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/member-360.constants')),
}));
vi.mock('../controllers/aeo-geo.controller', () => ({ AeoGeoController: class {} }));
vi.mock('../controllers/mktg-slides-export.controller', () => ({ MktgSlidesExportController: class {} }));
vi.mock('../controllers/mktg-agents.controller', () => ({ MktgAgentsController: class {} }));
vi.mock('../controllers/mktg-documents.controller', () => ({ MktgDocumentsController: class {} }));
vi.mock('../controllers/member-360.controller', () => ({ Member360Controller: class {} }));
vi.mock('../controllers/member-360-workbook.controller', () => ({
  Member360WorkbookController: class {
    public parseTracker = parseTracker;
    public deleteTracker = deleteTracker;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

import { MEMBER_360_MAX_BYTES } from '@lfx-one/shared/constants';
import { AuthorizationError, MicroserviceError, ResourceNotFoundError } from '../errors';
import router from './mktg-agents.route';

let server: Server;
let url: string;
beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.impersonationActive = req.headers['x-test-impersonation'] === '1';
    next();
  });
  app.use(router);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(error instanceof MicroserviceError) && !(error instanceof AuthorizationError)) return next(error);
    res.status(error.statusCode).json({ code: error.code });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/member-360/tracker`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Member 360 tracker raw parser', () => {
  beforeEach(() => {
    objects.clear();
    vi.clearAllMocks();
  });
  it('keeps four-argument error middleware and delegates when headers are already sent', () => {
    const route = router.stack.find((layer) => layer.route?.path === '/member-360/tracker/:id')?.route;
    const handler = route?.stack.at(-1)?.handle;
    expect(handler).toHaveLength(4);
    const error = new ResourceNotFoundError('Member 360 tracker');
    const next = vi.fn();
    if (typeof handler !== 'function') throw new Error('Missing private tracker error handler');
    Reflect.apply(handler, undefined, [error, {}, { headersSent: true }, next]);
    expect(next).toHaveBeenCalledWith(error);
  });
  it('blocks impersonated DELETE before the creator-bound erasure handler', async () => {
    const id = 'a'.repeat(64);
    objects.set(id, 'synthetic-owner');
    const response = await fetch(`${url}/${id}?project=sample-project`, { method: 'DELETE', headers: { 'x-test-impersonation': '1' } });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('');
    expect(deleteTracker).not.toHaveBeenCalled();
    expect(objects.has(id)).toBe(true);
  });
  it('returns an empty 404 without deleting another creator receipt', async () => {
    const id = 'a'.repeat(64);
    objects.set(id, 'synthetic-owner');
    const response = await fetch(`${url}/${id}?project=sample-project`, { method: 'DELETE', headers: { 'x-test-creator': 'synthetic-other' } });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(objects.has(id)).toBe(true);
  });
  it('returns empty 204 for the creator and repeated deletion of an already-gone id', async () => {
    const id = 'a'.repeat(64);
    objects.set(id, 'synthetic-owner');
    for (let n = 0; n < 2; n++) {
      const response = await fetch(`${url}/${id}?project=sample-project`, { method: 'DELETE', headers: { 'x-test-creator': 'synthetic-owner' } });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    }
    expect(objects.has(id)).toBe(false);
  });
  it('rejects an impersonated private upload before parsing or writing an object', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'x-test-impersonation': '1' },
      body: Buffer.from('company\nSynthetic Member'),
    });
    expect(response.status).toBe(403);
    expect(parseTracker).not.toHaveBeenCalled();
    expect(objects.size).toBe(0);
  });
  it('translates an oversized raw upload into structured 413 before the controller', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.alloc(MEMBER_360_MAX_BYTES + 1),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ code: 'PAYLOAD_TOO_LARGE' });
    expect(parseTracker).not.toHaveBeenCalled();
  });
});
