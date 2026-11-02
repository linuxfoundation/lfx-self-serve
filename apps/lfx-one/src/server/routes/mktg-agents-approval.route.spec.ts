// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const approve = vi.hoisted(() => vi.fn());
const comments = vi.hoisted(() => ({ add: vi.fn(), read: vi.fn() }));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/foundation-message.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/member-360.constants')),
}));
vi.mock('../controllers/aeo-geo.controller', () => ({ AeoGeoController: class {} }));
vi.mock('../controllers/mktg-slides-export.controller', () => ({ MktgSlidesExportController: class {} }));
vi.mock('../controllers/mktg-agents.controller', () => ({ MktgAgentsController: class {} }));
vi.mock('../controllers/member-360.controller', () => ({ Member360Controller: class {} }));
vi.mock('../controllers/member-360-workbook.controller', () => ({ Member360WorkbookController: class {} }));
vi.mock('../controllers/mktg-documents.controller', () => ({
  MktgDocumentsController: class {
    public approveRevision = approve;
    public addComment = comments.add;
    public listComments = comments.read;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

import { AuthorizationError } from '../errors';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';
import router from './mktg-agents.route';

describe('Marketing OS approval route', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([true, false])('guards comment writes without blocking normal writers (impersonating=%s)', (impersonationActive) => {
    const route = router.stack.find(
      (entry) => entry.route?.path === '/documents/:agentKey/:documentId/comments' && entry.route?.stack[0]?.method === 'post'
    )?.route;
    expect(route?.stack[0].handle).toBe(blockDuringImpersonation);
    const req = { path: '/documents/foundation-message/living/comments', method: 'POST', impersonationActive } as Request;
    const res = {} as Response;
    const next = vi.fn();
    route?.stack[0].handle(req, res, next);
    if (impersonationActive) {
      expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
      expect(comments.add).not.toHaveBeenCalled();
    } else {
      expect(next).toHaveBeenCalledWith();
      route?.stack[1].handle(req, res, next);
      expect(comments.add).toHaveBeenCalledWith(req, res, next);
    }
  });

  it.each(['/documents/:agentKey/:documentId/revise', '/documents/:agentKey/:documentId/revise/:requestId/release'])(
    'guards redraft writer route %s during impersonation',
    (path) => {
      const route = router.stack.find((entry) => entry.route?.path === path)?.route;
      expect(route?.stack[0].handle).toBe(blockDuringImpersonation);
      const next = vi.fn();
      route?.stack[0].handle({ path, method: 'POST', impersonationActive: true } as Request, {} as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
    }
  );

  it('keeps impersonated comment reads on the writer-gated controller', () => {
    const route = router.stack.find(
      (entry) => entry.route?.path === '/documents/:agentKey/:documentId/comments' && entry.route?.stack[0]?.method === 'get'
    )?.route;
    expect(route?.stack).toHaveLength(1);
    const req = { path: '/documents/foundation-message/living/comments', method: 'GET', impersonationActive: true } as Request;
    const res = {} as Response;
    const next = vi.fn();
    route?.stack[0].handle(req, res, next);
    expect(comments.read).toHaveBeenCalledWith(req, res, next);
  });
  it.each(['start', 'advance', 'result'])('guards rebuild %s before invoking its controller', (method) => {
    const layer = router.stack.find((entry) => entry.route?.path === `/rebuild/${method}`);
    expect(layer?.route?.stack[0].handle).toBe(blockDuringImpersonation);
    const next = vi.fn();
    layer?.route?.stack[0].handle({ path: `/rebuild/${method}`, method: 'POST', impersonationActive: true } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
  });

  it.each(['start', 'result', 'last'])('blocks family export %s during impersonation before calling the controller', (action) => {
    const layer = router.stack.find((entry) => entry.route?.path === `/slides-export/family/${action}`);
    expect(layer?.route?.stack[0].handle).toBe(blockDuringImpersonation);
    const next = vi.fn();
    layer?.route?.stack[0].handle(
      { path: `/slides-export/family/${action}`, method: action === 'last' ? 'GET' : 'POST', impersonationActive: true } as Request,
      {} as Response,
      next
    );
    expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
  });

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
