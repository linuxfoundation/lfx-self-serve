// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as orgs.route.spec.ts / require-executive-director.middleware.spec.ts: the import
// graph transitively reaches Angular's partially-compiled @angular/common, which needs the JIT
// compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the GH-2328 read-only lifecycle gate.
 *
 * `requireLiveFormation`'s own unit tests (none yet — it's thin enough that its behavior is
 * fully exercised here) would keep passing if `router.use('/formations/:projectUid/items/:itemKey',
 * requireLiveFormation)` in `formations.route.ts` were deleted, reordered below the item routes, or
 * scoped so narrowly it missed one of the eight mutation sub-paths. Since that registration IS the
 * fix, these tests drive real HTTP requests through the assembled router — one gate test (a non-live
 * lifecycle refuses with 409 CHECKLIST_READ_ONLY) plus one wiring test asserting every one of the
 * eight mutation routes is actually admitted through the same shared middleware, and that the
 * read-only item GET is not.
 */

const assertFormationMutable = vi.fn();
const getFormationItemDetail = vi.fn();
const completeFormationItem = vi.fn();
const skipFormationItem = vi.fn();
const requestFormationItem = vi.fn();
const updateFormationItemStatus = vi.fn();
const acceptFormationItem = vi.fn();
const rejectFormationItem = vi.fn();
const reopenFormationItem = vi.fn();
const updateFormationItem = vi.fn();
const getProjectFormation = vi.fn();
const getFormationsQueue = vi.fn();

vi.mock('../services/formation.service', () => ({
  formationService: {
    assertFormationMutable,
    getFormationItemDetail,
    completeFormationItem,
    skipFormationItem,
    requestFormationItem,
    updateFormationItemStatus,
    acceptFormationItem,
    rejectFormationItem,
    reopenFormationItem,
    updateFormationItem,
    getProjectFormation,
    getFormationsQueue,
  },
}));

// `@lfx-one/shared/*` path aliases aren't wired into the server-side vitest config — mocked
// wholesale, matching formation.controller.spec.ts's precedent. `validateUidParameter` /
// `validateItemKeyParameter` / `validateFoundationUidParameter` always accept: every path segment
// below is a real, well-formed string, so their own validation is out of scope for this
// router-level gate test.
vi.mock('@lfx-one/shared/constants', () => ({ FORMATION_QUEUE_SUB_STAGES: ['exploratory', 'engaged', 'on_hold'] }));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('../helpers/validation.helper', () => ({
  validateUidParameter: vi.fn(() => true),
  validateItemKeyParameter: vi.fn(() => true),
  validateFoundationUidParameter: vi.fn(() => true),
}));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth: vi.fn() }));
vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { checkRootAuditor: vi.fn(async () => true), checkRootWriter: vi.fn(async () => false) },
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
  },
}));

const formationsRouter = (await import('./formations.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', formationsRouter);
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  getFormationItemDetail.mockResolvedValue({ uid: 'formation-item:test' });
  for (const fn of [
    completeFormationItem,
    skipFormationItem,
    requestFormationItem,
    updateFormationItemStatus,
    acceptFormationItem,
    rejectFormationItem,
    reopenFormationItem,
    updateFormationItem,
  ]) {
    fn.mockResolvedValue({ uid: 'formation-item:test' });
  }
});

describe('formations router — requireLiveFormation gate (GH-2328)', () => {
  const PROJECT_UID = 'project:test-1';
  const ITEM_KEY = 'legal_entity';

  it('refuses a mutation with 409 CHECKLIST_READ_ONLY when the formation is not live', async () => {
    const { ConflictError } = await import('../errors');
    assertFormationMutable.mockRejectedValue(new ConflictError('This formation is read-only and cannot be modified', 'CHECKLIST_READ_ONLY'));

    const res = await fetch(`${baseUrl}/api/formations/${PROJECT_UID}/items/${ITEM_KEY}/complete`, { method: 'PATCH' });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('CHECKLIST_READ_ONLY');
    expect(completeFormationItem).not.toHaveBeenCalled();
  });

  // Every one of the eight mutation routes must run through the SAME shared gate — not eight
  // individually-wired checks a future ninth route could forget.
  it.each([
    ['complete', 'PATCH', `/formations/${PROJECT_UID}/items/${ITEM_KEY}/complete`, completeFormationItem],
    ['skip', 'PATCH', `/formations/${PROJECT_UID}/items/${ITEM_KEY}/skip`, skipFormationItem],
    ['request', 'PATCH', `/formations/${PROJECT_UID}/items/${ITEM_KEY}/request`, requestFormationItem],
    ['status', 'PATCH', `/formations/${PROJECT_UID}/items/${ITEM_KEY}/status`, updateFormationItemStatus],
    ['accept', 'POST', `/formations/${PROJECT_UID}/items/${ITEM_KEY}/accept`, acceptFormationItem],
    ['reject', 'POST', `/formations/${PROJECT_UID}/items/${ITEM_KEY}/reject`, rejectFormationItem],
    ['reopen', 'POST', `/formations/${PROJECT_UID}/items/${ITEM_KEY}/reopen`, reopenFormationItem],
    ['bare PATCH', 'PATCH', `/formations/${PROJECT_UID}/items/${ITEM_KEY}`, updateFormationItem],
  ] as const)('admits %s past the gate (calling assertFormationMutable) when the formation is live', async (_label, method, path, controllerFn) => {
    assertFormationMutable.mockResolvedValue(undefined);

    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'PATCH' || method === 'POST' ? '{}' : undefined,
    });

    expect(assertFormationMutable).toHaveBeenCalledWith(expect.anything(), PROJECT_UID);
    expect(res.status).not.toBe(409);
    expect(controllerFn).toHaveBeenCalled();
  });

  // Regression guard for the plan's "no ninth route silently skips the gate" requirement, restated
  // from the other direction: the read-only item GET must NOT be gated (`requireLiveFormation`
  // skips non-mutating methods), so a non-live formation's checklist stays readable.
  it('does not run the gate for the read-only item GET', async () => {
    assertFormationMutable.mockRejectedValue(new Error('should not be called'));

    const res = await fetch(`${baseUrl}/api/formations/${PROJECT_UID}/items/${ITEM_KEY}`);

    expect(res.status).not.toBe(409);
    expect(assertFormationMutable).not.toHaveBeenCalled();
    expect(getFormationItemDetail).toHaveBeenCalled();
  });
});
