// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const read = vi.hoisted(() => vi.fn());
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/foundation-message.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/member-360.constants')),
}));
vi.mock('../controllers/aeo-geo.controller', () => ({ AeoGeoController: class {} }));
vi.mock('../controllers/mktg-slides-export.controller', () => ({ MktgSlidesExportController: class {} }));
vi.mock('../controllers/mktg-agents.controller', () => ({
  MktgAgentsController: class {
    public getLastIntake = read;
  },
}));
vi.mock('../controllers/member-360.controller', () => ({ Member360Controller: class {} }));
vi.mock('../controllers/member-360-workbook.controller', () => ({ Member360WorkbookController: class {} }));
vi.mock('../controllers/mktg-documents.controller', () => ({ MktgDocumentsController: class {} }));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

import router from './mktg-agents.route';

describe('Marketing OS last-intake route', () => {
  it('registers only the GET and delegates to the writer-gated controller', () => {
    const route = router.stack.find((entry) => entry.route?.path === '/intakes/:agentKey/last')?.route;
    expect(route?.stack.map((entry) => entry.method)).toEqual(['get']);
    const req = { params: { agentKey: 'faq' }, query: { project: 'synthetic-project' } } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn();
    route?.stack[0].handle(req, res, next);
    expect(read).toHaveBeenCalledWith(req, res, next);
  });
});
