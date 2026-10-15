// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const approve = vi.hoisted(() => vi.fn());
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/foundation-message.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/member-360.constants')),
}));
vi.mock('../controllers/mktg-slides-export.controller', () => ({ MktgSlidesExportController: class {} }));
vi.mock('../controllers/mktg-agents.controller', () => ({ MktgAgentsController: class {} }));
vi.mock('../controllers/member-360.controller', () => ({ Member360Controller: class {} }));
vi.mock('../controllers/mktg-documents.controller', () => ({
  MktgDocumentsController: class {
    public approveRevision = approve;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

import { AuthorizationError } from '../errors';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';
import router from './mktg-agents.route';

describe('Marketing OS approval route', () => {
  it('installs the impersonation guard before the approval handler', () => {
    const layer = router.stack.find((entry) => entry.route?.path === '/documents/:agentKey/:documentId/revisions/:revisionId/approve');
    expect(layer?.route?.stack[0].method).toBe('post');
    expect(layer?.route?.stack[0].handle).toBe(blockDuringImpersonation);
    const next = vi.fn();
    const req = { path: '/documents/faq/living/revisions/example/approve', method: 'POST', impersonationActive: true } as Request;
    layer?.route?.stack[0].handle(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(approve).not.toHaveBeenCalled();
  });
});
