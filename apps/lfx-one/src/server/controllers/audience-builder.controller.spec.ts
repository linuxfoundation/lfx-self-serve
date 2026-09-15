// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceValidationError } from '../errors';

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../utils/shutdown', () => ({
  addShutdownHook: vi.fn(),
  isShuttingDown: vi.fn(() => false),
}));

vi.mock('../helpers/url-validation', () => ({ validateScrapeUrl: vi.fn(async (url: string) => url) }));

const proxyMethods = {
  getCapabilities: vi.fn(),
  discover: vi.fn(),
  searchLists: vi.fn(),
  getSuppressionLists: vi.fn(),
  getLastSent: vi.fn(),
  getExistingMasterLists: vi.fn(),
  previewCount: vi.fn(),
  composeMaster: vi.fn(),
  runQa: vi.fn(),
};

// One mock stands in for all nine upstream calls, because the controller no longer holds any
// audience logic — every handler validates, delegates, and shapes the response.
//
// `AudienceComposePartialError` is kept REAL: the controller branches on `instanceof`, so a
// stubbed class would make the 502-with-partial-state path untestable — and that path is the whole
// reason a failed compose is not answered with a bare error.
vi.mock('../services/audience-builder-proxy.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/audience-builder-proxy.service')>();
  return {
    AudienceComposePartialError: actual.AudienceComposePartialError,
    AudienceBuilderProxyService: class {
      public constructor() {
        Object.assign(this, proxyMethods);
      }
    },
  };
});

const { AudienceBuilderController } = await import('./audience-builder.controller');
const { validateScrapeUrl } = await import('../helpers/url-validation');
const { AudienceComposePartialError } = await import('../services/audience-builder-proxy.service');
const { isShuttingDown } = await import('../utils/shutdown');

const scrapeUrl = vi.mocked(validateScrapeUrl);
const shuttingDown = vi.mocked(isShuttingDown);

/** Every route is project-scoped, so the slug is part of the baseline request. */
function buildReq(body: unknown = {}, query: Record<string, unknown> = {}): Request {
  return { body, query: { project: 'tlf', ...query }, path: '/api/campaigns/audience-builder/test', method: 'POST' } as unknown as Request;
}

/** A JSON response double: enough surface for `status().json()` and nothing more. */
function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

interface StreamRes extends Response {
  chunks: string[];
  headers: Record<string, string>;
  flushed: boolean;
  ended: boolean;
  fireClose: () => void;
}

/** An SSE response double that records the wire bytes and can simulate a client disconnect. */
function buildStreamRes(): StreamRes {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const closeHandlers: (() => void)[] = [];
  const res = {
    chunks,
    headers,
    flushed: false,
    ended: false,
    writableEnded: false,
    setHeader: (key: string, value: string) => {
      headers[key] = value;
    },
    flushHeaders: () => {
      res.flushed = true;
    },
    socket: { setNoDelay: vi.fn(), destroy: vi.fn() },
    on: (event: string, handler: () => void) => {
      if (event === 'close') closeHandlers.push(handler);
      return res;
    },
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: () => {
      res.ended = true;
      return res;
    },
    json: vi.fn(),
    status: vi.fn(() => res),
    fireClose: () => closeHandlers.forEach((handler) => handler()),
  };
  return res as unknown as StreamRes;
}

/** The `event:` names written to the stream, in order. */
function eventNames(res: StreamRes): string[] {
  return res.chunks.map((chunk) => chunk.split('\n')[0]?.replace('event: ', '') ?? '');
}

/** The parsed `data:` payload of the first frame named `name`. */
function payloadOf(res: StreamRes, name: string): unknown {
  const frame = res.chunks.find((chunk) => chunk.startsWith(`event: ${name}\n`));
  const data = frame?.split('\n')[1]?.replace('data: ', '') ?? 'null';
  return JSON.parse(data);
}

/** The error handed to `next`, typed for assertions. */
function nextError(next: NextFunction): ServiceValidationError {
  return vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError;
}

let controller: InstanceType<typeof AudienceBuilderController>;
let next: NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
  shuttingDown.mockReturnValue(false);
  scrapeUrl.mockImplementation(async (url: string) => url);
  controller = new AudienceBuilderController();
  next = vi.fn();
});

describe('project scoping', () => {
  it('refuses every handler without a project rather than calling upstream unscoped', async () => {
    const unscoped = {
      body: { listIds: ['10'], eventUrl: 'https://events.example/k', listRef: '10' },
      query: {},
      path: '/x',
      method: 'POST',
    } as unknown as Request;

    // Upstream resolves HubSpot credentials from the project's stored connection, so a request
    // with no project cannot reach a portal at all — and `/projects//…` is a different route that
    // 404s at the gateway, which reads as "no such feature" rather than "no project given".
    await controller.getCapabilities(unscoped, buildRes(), next);
    expect(proxyMethods.getCapabilities).not.toHaveBeenCalled();
    expect(nextError(next).toResponse()['errors']).toMatchObject([{ field: 'project' }]);

    for (const handler of [
      controller.discover,
      controller.searchLists,
      controller.getSuppressionLists,
      controller.getLastSent,
      controller.getExistingMasterLists,
      controller.previewCount,
      controller.composeMaster,
      controller.runQa,
    ]) {
      const localNext = vi.fn();
      await handler.call(controller, unscoped, buildStreamRes(), localNext);
      expect(vi.mocked(localNext).mock.calls[0]?.[0]).toBeInstanceOf(ServiceValidationError);
    }

    expect(proxyMethods.discover).not.toHaveBeenCalled();
    expect(proxyMethods.composeMaster).not.toHaveBeenCalled();
  });
});

describe('getCapabilities', () => {
  it('passes upstream capabilities through so the client can degrade instead of failing per click', async () => {
    proxyMethods.getCapabilities.mockResolvedValue({ hubspotConfigured: false, detail: 'No HubSpot connection for this project.' });
    const res = buildRes();

    await controller.getCapabilities(buildReq(), res, next);

    // The degrade banner exists precisely for this: tab rendered, actions disabled.
    expect(proxyMethods.getCapabilities).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(res.json).toHaveBeenCalledWith({ hubspotConfigured: false, detail: 'No HubSpot connection for this project.' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('discover', () => {
  const discovered = {
    event: { eventName: 'KubeCon NA', brandShort: 'CNCF', eventDates: ['2026-11-10'] },
    result: { lists: [], missingSignals: ['page_view'] },
    inspected: 3,
  };

  it('refuses a missing eventUrl before touching the stream', async () => {
    const res = buildStreamRes();

    await controller.discover(buildReq({}), res, next);

    expect(res.flushed).toBe(false);
    expect(proxyMethods.discover).not.toHaveBeenCalled();
    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
  });

  it('rejects an SSRF-guard failure BEFORE flushing headers', async () => {
    scrapeUrl.mockRejectedValue(new Error('Blocked host'));
    const res = buildStreamRes();

    await controller.discover(buildReq({ eventUrl: 'http://169.254.169.254/' }), res, next);

    // `apiErrorHandler` abdicates once `res.headersSent`, so a rejection after the flush would
    // hang the client on an open stream instead of failing the request. Upstream re-validates the
    // same URL through its own guard; neither side may rely on the other having checked.
    expect(res.flushed).toBe(false);
    expect(proxyMethods.discover).not.toHaveBeenCalled();
    expect(nextError(next).toResponse()['errors']).toEqual([{ field: 'eventUrl', message: 'Blocked host', code: 'FIELD_VALIDATION_ERROR' }]);
  });

  it('answers a shutting-down server with 503 and opens no stream', async () => {
    shuttingDown.mockReturnValue(true);
    const res = buildStreamRes();

    await controller.discover(buildReq({ eventUrl: 'https://events.example/kubecon' }), res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.flushed).toBe(false);
  });

  it('unpacks the single upstream response into the ticker, identity, result and done frames', async () => {
    proxyMethods.discover.mockResolvedValue(discovered);
    const res = buildStreamRes();

    await controller.discover(buildReq({ eventUrl: 'https://events.example/kubecon' }), res, next);

    // Upstream discovery is ONE synchronous call — Goa's HTTP transport has no SSE encoding — so
    // the frames are this handler's shim. Their order is still the contract: the UI labels the
    // panel from `event` and fetches suppression lists for that brand off it.
    expect(proxyMethods.discover).toHaveBeenCalledWith(expect.anything(), 'tlf', 'https://events.example/kubecon');
    expect(eventNames(res)).toEqual(['progress', 'event', 'progress', 'discovered', 'done']);
    expect(payloadOf(res, 'event')).toMatchObject({ brandShort: 'CNCF' });
    expect(payloadOf(res, 'discovered')).toMatchObject({ missingSignals: ['page_view'] });
    expect(res.ended).toBe(true);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
  });

  it('omits the identity frame when upstream could not name the event', async () => {
    proxyMethods.discover.mockResolvedValue({ ...discovered, event: null });
    const res = buildStreamRes();

    await controller.discover(buildReq({ eventUrl: 'https://events.example/kubecon' }), res, next);

    // An absent frame is honest; an empty one would have the UI label the panel with a blank name.
    expect(eventNames(res)).toEqual(['progress', 'progress', 'discovered', 'done']);
  });

  it('reports a mid-stream failure as an error event and still closes the stream', async () => {
    proxyMethods.discover.mockRejectedValue(new Error('HubSpot 500'));
    const res = buildStreamRes();

    await controller.discover(buildReq({ eventUrl: 'https://events.example/kubecon' }), res, next);

    // The opening ticker is already on the wire by the time upstream fails — it is written
    // before the call, so the client sees work started and then the failure, not silence.
    expect(eventNames(res)).toEqual(['progress', 'error']);
    expect(res.ended).toBe(true);
    // The response is already owned by this handler, so the error middleware is unreachable.
    expect(next).not.toHaveBeenCalled();
  });

  it('writes nothing more once the client has disconnected', async () => {
    const res = buildStreamRes();
    proxyMethods.discover.mockImplementation(async () => {
      res.fireClose();
      return discovered;
    });

    await controller.discover(buildReq({ eventUrl: 'https://events.example/kubecon' }), res, next);

    // Only the opening ticker, written before the upstream call and so before the disconnect.
    expect(eventNames(res)).toEqual(['progress']);
    // `end()` on an already-closed socket is the write-after-end that shows up as a 500 in logs.
    expect(res.ended).toBe(false);
  });
});

describe('searchLists', () => {
  it('refuses a blank query rather than searching for everything', async () => {
    await controller.searchLists(buildReq({}, { q: '   ' }), buildRes(), next);

    expect(proxyMethods.searchLists).not.toHaveBeenCalled();
    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
  });

  it('answers with the bare array the client expects', async () => {
    const results = [{ listId: '10', name: 'KubeCon NA Registrants', size: 4200, hubspotUrl: 'https://app.hubspot.com/x/10' }];
    proxyMethods.searchLists.mockResolvedValue(results);
    const res = buildRes();

    await controller.searchLists(buildReq({}, { q: 'KubeCon' }), res, next);

    expect(proxyMethods.searchLists).toHaveBeenCalledWith(expect.anything(), 'tlf', 'KubeCon');
    expect(res.json).toHaveBeenCalledWith(results);
  });

  it('ignores a repeated query param instead of searching for "q1,q2"', async () => {
    await controller.searchLists(buildReq({}, { q: ['a', 'b'] }), buildRes(), next);

    expect(proxyMethods.searchLists).not.toHaveBeenCalled();
    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
  });
});

describe('getSuppressionLists', () => {
  it('accepts an empty brand and event, since the standard lists are portfolio-wide', async () => {
    proxyMethods.getSuppressionLists.mockResolvedValue([]);
    const res = buildRes();

    await controller.getSuppressionLists(buildReq({}, {}), res, next);

    expect(proxyMethods.getSuppressionLists).toHaveBeenCalledWith(expect.anything(), 'tlf', '', '');
    expect(res.json).toHaveBeenCalledWith([]);
  });
});

describe('getLastSent', () => {
  it('requires an event name', async () => {
    await controller.getLastSent(buildReq({}, {}), buildRes(), next);

    expect(proxyMethods.getLastSent).not.toHaveBeenCalled();
    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
  });

  it('clamps an oversized limit instead of letting upstream reject it', async () => {
    proxyMethods.getLastSent.mockResolvedValue([]);

    await controller.getLastSent(buildReq({}, { eventName: 'KubeCon NA', limit: '500' }), buildRes(), next);

    // Upstream's `Maximum(10)` REJECTS an over-limit value, so a picker asking for one row too
    // many should get ten rows rather than a 400 the operator cannot act on.
    expect(proxyMethods.getLastSent).toHaveBeenCalledWith(expect.anything(), 'tlf', 'KubeCon NA', '', 10);
  });

  it.each([
    ['a non-numeric limit', 'many'],
    ['a zero limit', '0'],
    ['a negative limit', '-3'],
  ])('falls back to the default for %s', async (_label, limit) => {
    proxyMethods.getLastSent.mockResolvedValue([]);

    await controller.getLastSent(buildReq({}, { eventName: 'KubeCon NA', limit }), buildRes(), next);

    expect(proxyMethods.getLastSent).toHaveBeenCalledWith(expect.anything(), 'tlf', 'KubeCon NA', '', 3);
  });
});

describe('getExistingMasterLists', () => {
  it('requires an event name', async () => {
    await controller.getExistingMasterLists(buildReq({}, { brandShort: 'CNCF' }), buildRes(), next);

    expect(proxyMethods.getExistingMasterLists).not.toHaveBeenCalled();
    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
  });

  it('passes brand and event straight through', async () => {
    proxyMethods.getExistingMasterLists.mockResolvedValue([]);

    await controller.getExistingMasterLists(buildReq({}, { brandShort: 'CNCF', eventName: 'KubeCon NA' }), buildRes(), next);

    expect(proxyMethods.getExistingMasterLists).toHaveBeenCalledWith(expect.anything(), 'tlf', 'CNCF', 'KubeCon NA');
  });
});

describe('previewCount', () => {
  it('answers an empty selection itself as an exact zero', async () => {
    const res = buildRes();

    await controller.previewCount(buildReq({ listIds: [] }), res, next);

    // Upstream's `list_ids` has `MinLength(1)`, so sending none is a 400 — and "no lists
    // selected" is an exact zero, not a malformed request.
    expect(proxyMethods.previewCount).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ exact: true, estimate: 0, count: 0, reason: '' });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-array', { listIds: '10' }],
    ['an array holding a non-string', { listIds: ['10', 20] }],
  ])('refuses %s', async (_label, body) => {
    await controller.previewCount(buildReq(body), buildRes(), next);

    expect(proxyMethods.previewCount).not.toHaveBeenCalled();
    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
  });

  it('drops blank entries before counting', async () => {
    proxyMethods.previewCount.mockResolvedValue({ exact: true, estimate: 1, count: 1, reason: '' });

    await controller.previewCount(buildReq({ listIds: ['10', '  ', ' 20 '] }), buildRes(), next);

    expect(proxyMethods.previewCount).toHaveBeenCalledWith(expect.anything(), 'tlf', ['10', '20']);
  });
});

describe('composeMaster', () => {
  const created = { listId: '100', name: '26Q3 - CNCF - KubeCon NA - Master', size: 0, hubspotUrl: 'https://app.hubspot.com/x/100' };

  it('refuses an empty selection without creating anything', async () => {
    await controller.composeMaster(buildReq({ listIds: [] }), buildRes(), next);

    expect(proxyMethods.composeMaster).not.toHaveBeenCalled();
    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
  });

  it('refuses a malformed exclusion list', async () => {
    await controller.composeMaster(buildReq({ listIds: ['10'], excludeListIds: '50' }), buildRes(), next);

    expect(proxyMethods.composeMaster).not.toHaveBeenCalled();
    expect(nextError(next).toResponse()['errors']).toMatchObject([{ field: 'excludeListIds' }]);
  });

  it('forwards the naming inputs alongside the cleaned selections', async () => {
    proxyMethods.composeMaster.mockResolvedValue({ master: created, sourceListIds: ['10'] });

    await controller.composeMaster(
      buildReq({ listIds: [' 10 '], excludeListIds: ['50'], eventName: 'KubeCon NA', brandShort: 'CNCF', eventDates: ['2026-08-14'] }),
      buildRes(),
      next
    );

    expect(proxyMethods.composeMaster).toHaveBeenCalledWith(
      expect.anything(),
      'tlf',
      expect.objectContaining({
        listIds: ['10'],
        excludeListIds: ['50'],
        eventName: 'KubeCon NA',
        brandShort: 'CNCF',
        eventDates: ['2026-08-14'],
      })
    );
  });

  it('surfaces the orphaned suppression list as a 502 partial rather than a bare error', async () => {
    const suppression = { listId: '99', name: '26Q3 - KubeCon NA - Combined Suppression', size: 0, hubspotUrl: 'https://app.hubspot.com/x/99' };
    proxyMethods.composeMaster.mockRejectedValue(new AudienceComposePartialError('Master list create failed', suppression));
    const res = buildRes();

    await controller.composeMaster(buildReq({ listIds: ['10'], excludeListIds: ['50'] }), res, next);

    // Compose is not idempotent: an operator told only "failed" clicks again and leaves a second
    // suppression list behind, so the one already created has to come back with the failure.
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ suppression, error: 'Master list create failed' });
    expect(next).not.toHaveBeenCalled();
  });

  it('sends any other failure to the error middleware', async () => {
    proxyMethods.composeMaster.mockRejectedValue(new Error('boom'));
    const res = buildRes();

    await controller.composeMaster(buildReq({ listIds: ['10'] }), res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});

describe('runQa', () => {
  it('requires a list reference', async () => {
    await controller.runQa(buildReq({ listRef: '  ' }), buildRes(), next);

    expect(proxyMethods.runQa).not.toHaveBeenCalled();
    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
  });

  it('coerces the jurisdiction flags to real booleans', async () => {
    proxyMethods.runQa.mockResolvedValue({ needsDisambiguation: true, candidates: [] });

    await controller.runQa(buildReq({ listRef: '10', targetsEu: 'yes', targetsCa: true }), buildRes(), next);

    // A truthy string must not turn into an EU send: `targetsEu` decides whether a missing GDPR
    // suppression list is a CRITICAL failure or nothing at all.
    expect(proxyMethods.runQa).toHaveBeenCalledWith(expect.anything(), 'tlf', { listRef: '10', targetsEu: false, targetsCa: true });
  });
});

describe('composeMaster payload', () => {
  it('forwards only validated fields, not whatever the body carried', async () => {
    // `{ ...body, listIds, excludeListIds }` typed every field as validated when only the two
    // arrays were. The proxy picks named fields, so an EXTRA property never reached the wire —
    // but a MISTYPED one did: `name: {}` is truthy, so it passed the proxy's `request.name ?`
    // guard and went upstream as an object where a string is declared.
    proxyMethods.composeMaster.mockResolvedValue({ master: { listId: '1', name: 'm', size: 1, hubspotUrl: 'u' }, sourceListIds: [] });

    const req = buildReq(
      {
        listIds: ['101'],
        name: { nested: 'not a string' },
        eventName: 'KubeCon NA',
        injected: 'should not survive',
      },
      { project: 'tlf' }
    );
    await controller.composeMaster(req, buildRes(), vi.fn());

    const sent = proxyMethods.composeMaster.mock.calls.at(-1)?.[2];
    expect(sent, 'a mistyped name was forwarded upstream').not.toHaveProperty('name');
    expect(sent, 'an unknown body property was forwarded upstream').not.toHaveProperty('injected');
    expect(sent).toMatchObject({ listIds: ['101'], eventName: 'KubeCon NA' });
  });
});
