// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const parseTracker = vi.hoisted(() => vi.fn((_req: express.Request, res: express.Response) => res.json({ parsed: true })));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/foundation-message.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/member-360.constants')),
}));
vi.mock('../controllers/mktg-slides-export.controller', () => ({ MktgSlidesExportController: class {} }));
vi.mock('../controllers/mktg-agents.controller', () => ({ MktgAgentsController: class {} }));
vi.mock('../controllers/mktg-documents.controller', () => ({ MktgDocumentsController: class {} }));
vi.mock('../controllers/member-360.controller', () => ({ Member360Controller: class {} }));
vi.mock('../controllers/member-360-workbook.controller', () => ({
  Member360WorkbookController: class {
    public parseTracker = parseTracker;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

import { MEMBER_360_MAX_BYTES } from '@lfx-one/shared/constants';
import { MicroserviceError } from '../errors';
import router from './mktg-agents.route';

let server: Server;
let url: string;
beforeAll(async () => {
  const app = express();
  app.use(router);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!(error instanceof MicroserviceError)) return next(error);
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
