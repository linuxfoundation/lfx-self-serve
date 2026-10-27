// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACCESS_CHECK_BATCH_SIZE, SURVEY_COMMITTEE_ACCESS_TIMEOUT_MS } from '@lfx-one/shared/constants';
import type { ApiRequestOptions, Survey, SurveyCommittee } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const { getEffectiveUsernameMock, getEffectiveNameMock, resolveUserIdentityMock, proxyRequestMock, fetchAllQueryResourcesMock, enrichWithProjectDataMock } =
  vi.hoisted(() => ({
    getEffectiveUsernameMock: vi.fn(),
    getEffectiveNameMock: vi.fn(),
    resolveUserIdentityMock: vi.fn(),
    proxyRequestMock: vi.fn(),
    fetchAllQueryResourcesMock: vi.fn(),
    enrichWithProjectDataMock: vi.fn(),
  }));

vi.mock('../utils/auth-helper', () => ({
  getEffectiveUsername: getEffectiveUsernameMock,
  getEffectiveName: getEffectiveNameMock,
  resolveUserIdentity: resolveUserIdentityMock,
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: vi.fn().mockImplementation(() => ({ proxyRequest: proxyRequestMock })),
}));
// The shared utils barrel pulls in @angular/forms, which cannot load in a plain Node runtime.
vi.mock('@lfx-one/shared/utils', async () => {
  const { getSurveyDisplayStatus } = await import('../../../../../packages/shared/src/utils/survey.utils');
  return { getSurveyDisplayStatus };
});
vi.mock('../helpers/entity-project-enrichment.helper', () => ({ fetchEntityProject: vi.fn(), toEntityProjectFields: vi.fn() }));
vi.mock('../helpers/query-service.helper', () => ({ fetchAllQueryResources: fetchAllQueryResourcesMock }));
vi.mock('./etag.service', () => ({ ETagService: vi.fn() }));
vi.mock('./project.service', () => ({
  ProjectService: vi.fn().mockImplementation(() => ({ enrichWithProjectData: enrichWithProjectDataMock, getProjectById: vi.fn() })),
}));
vi.mock('../helpers/poll-endpoint.helper', () => ({ pollEndpoint: vi.fn().mockResolvedValue(true) }));
vi.mock('./logger.service', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    startOperation: vi.fn().mockReturnValue(0),
    success: vi.fn(),
    sanitize: vi.fn((v: unknown) => v),
  },
}));

import { AccessCheckService } from './access-check.service';
import { ApiClientService } from './api-client.service';
import { SurveyService } from './survey.service';

describe('SurveyService.createSurvey — creator identity', () => {
  let service: SurveyService;
  const req = { path: '/api/surveys', oidc: { user: { name: 'Session User' } } } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SurveyService();
  });

  it('refuses to create a survey with a 401 when no LFID resolves', async () => {
    getEffectiveUsernameMock.mockReturnValue(null);

    await expect(service.createSurvey(req, { survey_title: 't' } as any)).rejects.toMatchObject({ statusCode: 401 });
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('stamps creator id, username and name from the effective identity', async () => {
    getEffectiveUsernameMock.mockReturnValue('target-lfid');
    getEffectiveNameMock.mockReturnValue('Target User');
    proxyRequestMock.mockResolvedValueOnce({ uid: 'survey-1' });

    await service.createSurvey(req, { survey_title: 't' } as any).catch(() => undefined);

    expect(proxyRequestMock.mock.calls[0][5]).toMatchObject({
      creator_id: 'target-lfid',
      creator_username: 'target-lfid',
      creator_name: 'Target User',
    });
  });
});

function surveyRow(uid: string, committeeUids: string[], overrides: Partial<Survey> = {}): Survey {
  return {
    uid,
    survey_title: uid,
    survey_status: 'draft',
    survey_cutoff_date: null,
    committees: committeeUids.map((committeeUid) => ({ committee_uid: committeeUid, project_uid: 'project-1' }) as SurveyCommittee),
    ...overrides,
  } as Survey;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('SurveyService.getSurveys — caller-scoped committee writer grants', () => {
  let service: SurveyService;
  let restoreAccessTimeout: (() => void) | undefined;
  const req = { path: '/api/surveys', bearerToken: 'caller-token' } as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    getEffectiveUsernameMock.mockReset();
    getEffectiveNameMock.mockReset();
    proxyRequestMock.mockReset();
    resolveUserIdentityMock.mockReset().mockResolvedValue({});
    fetchAllQueryResourcesMock.mockReset().mockResolvedValue([]);
    enrichWithProjectDataMock.mockReset().mockImplementation(async (_req: Request, surveys: Survey[]) => surveys);
    service = new SurveyService();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    restoreAccessTimeout?.();
    restoreAccessTimeout = undefined;
    vi.useRealTimers();
  });

  const useDeadlineAccessTransport = (): void => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Access deadline elapsed', 'TimeoutError')), ms);
      return controller.signal;
    });
    restoreAccessTimeout = () => timeoutSpy.mockRestore();
    const client = new ApiClientService();
    proxyRequestMock.mockImplementation(
      (request: Request, _service: string, _path: string, _method: string, _query: unknown, data: unknown, _headers: unknown, options?: ApiRequestOptions) =>
        client
          .request<{ results: string[] }>('POST', 'https://example.invalid/access-check', request.bearerToken, undefined, data, undefined, options)
          .then((response) => response.data)
    );
  };

  it('returns all readable rows at the shared deadline when the first access batch stalls', async () => {
    useDeadlineAccessTransport();
    const count = ACCESS_CHECK_BATCH_SIZE * 2 + 1;
    fetchAllQueryResourcesMock.mockResolvedValue(
      Array.from({ length: count }, (_, index) => surveyRow(`survey-${index}`, [`committee-${index}`], { committee_writer: true }))
    );
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    let rows: Survey[] | undefined;
    const pending = service.getSurveys(req).then((result) => (rows = result));

    await vi.advanceTimersByTimeAsync(SURVEY_COMMITTEE_ACCESS_TIMEOUT_MS);

    expect(rows).toHaveLength(count);
    expect(rows?.every((row) => row.committee_writer === false)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await pending;
  });

  it('keeps verified grants while a later batch consumes only the remaining shared budget', async () => {
    useDeadlineAccessTransport();
    const count = ACCESS_CHECK_BATCH_SIZE * 2 + 1;
    fetchAllQueryResourcesMock.mockResolvedValue(Array.from({ length: count }, (_, index) => surveyRow(`survey-${index}`, [`committee-${index}`])));
    let calls = 0;
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          if (++calls === 1) {
            setTimeout(() => resolve(new Response(JSON.stringify({ results: ['committee:committee-0#writer@user:caller\ttrue'] }), { status: 200 })), 2000);
          } else {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
          }
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    let rows: Survey[] | undefined;
    const pending = service.getSurveys(req).then((result) => (rows = result));

    await vi.advanceTimersByTimeAsync(SURVEY_COMMITTEE_ACCESS_TIMEOUT_MS);

    expect(rows).toHaveLength(count);
    expect(rows?.[0].committee_writer).toBe(true);
    expect(rows?.slice(1).every((row) => row.committee_writer === false)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await pending;
  });

  it('grants a draft through its secondary committee without granting denied or unrelated rows', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('secondary-grant', ['primary-denied', 'secondary-writer']),
      surveyRow('denied', ['primary-denied'], { committee_writer: true }),
      surveyRow('unrelated', ['other-committee'], { committee_writer: true }),
    ]);
    proxyRequestMock.mockResolvedValue({
      results: [
        'committee:secondary-writer#writer@user:caller\ttrue',
        'committee:primary-denied#writer@user:caller\tfalse',
        'committee:other-committee#viewer@user:caller\ttrue',
        'committee:not-associated#writer@user:caller\ttrue',
      ],
    });

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => row.committee_writer)).toEqual([true, false, false]);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    expect(proxyRequestMock.mock.calls[0][2]).toBe('/access-check');
  });

  it('deduplicates committee checks across rows and skips empty or blank associations', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('duplicates', ['shared', 'shared', '', '   ']),
      surveyRow('shared-row', ['shared']),
      surveyRow('empty', [], { committee_writer: true }),
      surveyRow('blank', ['', '\t'], { committee_writer: true }),
    ]);
    proxyRequestMock.mockResolvedValue({ results: ['committee:shared#writer@user:caller\ttrue'] });

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => row.committee_writer)).toEqual([true, true, false, false]);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    expect(proxyRequestMock.mock.calls[0][5].requests).toEqual(['committee:shared#writer']);
  });

  it('checks only effective drafts, respecting status case normalization and the closed sentinel', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('uppercase-draft', ['draft-committee'], { survey_status: 'DRAFT' }),
      surveyRow('open', ['open-committee'], { survey_status: 'OPEN', committee_writer: true }),
      surveyRow('sent', ['sent-committee'], { survey_status: 'SENT', survey_cutoff_date: '2999-01-01', committee_writer: true }),
      surveyRow('closed', ['closed-committee'], { survey_status: 'closed', committee_writer: true }),
      surveyRow('closed-sentinel', ['sentinel-committee'], { response_status: 'CLOSED', committee_writer: true }),
      surveyRow('unknown', ['unknown-committee'], { survey_status: 'unexpected', committee_writer: true }),
    ]);
    proxyRequestMock.mockResolvedValue({ results: ['committee:draft-committee#writer@user:caller\ttrue'] });

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => row.committee_writer)).toEqual([true, false, false, false, false, false]);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    expect(proxyRequestMock.mock.calls[0][5].requests).toEqual(['committee:draft-committee#writer']);
  });

  it('returns readable rows without authorization requests when there are no eligible committee UIDs', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('empty-draft', [], { committee_writer: true }),
      surveyRow('closed', ['unused'], { response_status: 'closed', committee_writer: true }),
    ]);

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => [row.uid, row.committee_writer])).toEqual([
      ['empty-draft', false],
      ['closed', false],
    ]);
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it('bounds more than 100 unique committee checks to sequential batches with one request in flight', async () => {
    const committeeCount = ACCESS_CHECK_BATCH_SIZE * 2 + 1;
    fetchAllQueryResourcesMock.mockResolvedValue(Array.from({ length: committeeCount }, (_, index) => surveyRow(`survey-${index}`, [`committee-${index}`])));
    const first = deferred<{ results: string[] }>();
    const second = deferred<{ results: string[] }>();
    const third = deferred<{ results: string[] }>();
    const started = [deferred<void>(), deferred<void>(), deferred<void>()];
    const pending = [first, second, third];
    let inFlight = 0;
    let maxInFlight = 0;
    let nextBatch = 0;
    proxyRequestMock.mockImplementation(() => {
      const index = nextBatch++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      started[index].resolve();
      return pending[index].promise.finally(() => inFlight--);
    });

    const result = service.getSurveys(req);
    await started[0].promise;
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    first.resolve({ results: [`committee:committee-${ACCESS_CHECK_BATCH_SIZE - 1}#writer@user:caller\ttrue`] });
    await started[1].promise;
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
    second.resolve({ results: [] });
    await started[2].promise;
    expect(proxyRequestMock).toHaveBeenCalledTimes(3);
    third.resolve({ results: [`committee:committee-${committeeCount - 1}#writer@user:caller\ttrue`] });
    const rows = await result;

    expect(maxInFlight).toBe(1);
    expect(proxyRequestMock.mock.calls.map((call) => call[5].requests.length)).toEqual([ACCESS_CHECK_BATCH_SIZE, ACCESS_CHECK_BATCH_SIZE, 1]);
    expect(rows.filter((row) => row.committee_writer).map((row) => row.uid)).toEqual([`survey-${ACCESS_CHECK_BATCH_SIZE - 1}`, `survey-${committeeCount - 1}`]);
    expect(rows).toHaveLength(committeeCount);
  });

  it('fails closed for a failed batch while continuing to resolve later committees and keeping every row readable', async () => {
    const committeeCount = ACCESS_CHECK_BATCH_SIZE + 1;
    fetchAllQueryResourcesMock.mockResolvedValue(
      Array.from({ length: committeeCount }, (_, index) => surveyRow(`survey-${index}`, [`committee-${index}`], { committee_writer: true }))
    );
    proxyRequestMock.mockRejectedValueOnce(new Error('access service unavailable')).mockResolvedValueOnce({
      results: [`committee:committee-${ACCESS_CHECK_BATCH_SIZE}#writer@user:caller\ttrue`],
    });

    const rows = await service.getSurveys(req);

    expect(rows).toHaveLength(committeeCount);
    expect(rows.slice(0, ACCESS_CHECK_BATCH_SIZE).every((row) => row.committee_writer === false)).toBe(true);
    expect(rows[ACCESS_CHECK_BATCH_SIZE].committee_writer).toBe(true);
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
  });

  it('never grants unanswered or malformed access results even when the index supplied a grant', async () => {
    fetchAllQueryResourcesMock.mockResolvedValue([
      surveyRow('missing', ['missing'], { committee_writer: true }),
      surveyRow('malformed', ['malformed'], { committee_writer: true }),
    ]);
    proxyRequestMock.mockResolvedValue({ results: ['committee:malformed#writer@user:caller\tunknown', 'invalid'] });

    const rows = await service.getSurveys(req);

    expect(rows.map((row) => row.committee_writer)).toEqual([false, false]);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
  });

  it('resolves grants for each caller independently on the same service and indexed rows', async () => {
    const indexed = [surveyRow('shared-row', ['shared'], { committee_writer: true })];
    const deniedReq = { path: '/api/surveys', bearerToken: 'denied-token' } as Request;
    fetchAllQueryResourcesMock.mockResolvedValue(indexed);
    proxyRequestMock.mockImplementation(async (request: Request) => ({
      results: [`committee:shared#writer@user:caller\t${request === req ? 'true' : 'false'}`],
    }));

    const grantedRows = await service.getSurveys(req);
    const deniedRows = await service.getSurveys(deniedReq);

    expect(grantedRows[0].committee_writer).toBe(true);
    expect(deniedRows[0].committee_writer).toBe(false);
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
  });

  it('preserves the response-status join and owning project UID without granting a closed-sentinel row', async () => {
    resolveUserIdentityMock.mockResolvedValue({ username: 'caller' });
    fetchAllQueryResourcesMock
      .mockResolvedValueOnce([surveyRow('responded-draft', ['writer']), surveyRow('closed-sentinel', ['writer'], { response_status: 'CLOSED' })])
      .mockResolvedValueOnce([
        { survey_uid: 'responded-draft', response_datetime: '2026-01-01T00:00:00Z' },
        { survey_uid: 'closed-sentinel', response_datetime: '2026-01-01T00:00:00Z' },
      ]);
    proxyRequestMock.mockResolvedValue({ results: ['committee:writer#writer@user:caller\ttrue'] });

    const rows = await service.getSurveys(req);

    expect(rows[0]).toMatchObject({
      committee_writer: true,
      response_status: 'responded',
      project_uid: 'project-1',
    });
    expect(rows[1].committee_writer).toBe(false);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
  });
});

describe('SurveyService.getSurveyResponses — personal link gate', () => {
  let service: SurveyService;
  let checkAccessSpy: MockInstance<AccessCheckService['checkAccess']>;
  const req = { path: '/api/surveys/s-1/responses', bearerToken: 'caller-token' } as Request;
  // A multi-foundation survey: the caller writes p-1 only.
  const survey = {
    committees: [
      { committee_uid: 'c-1', project_uid: 'p-1' },
      { committee_uid: 'c-2', project_uid: 'p-2' },
    ],
  };
  const rows = [
    { id: 'r-1', committee_uid: 'c-1', survey_link: ' https://www.surveymonkey.com/r/abc ' },
    { id: 'r-2', committee_uid: 'c-1', survey_link: 'https://evil.example.com/phish' },
    { id: 'r-3', committee_uid: 'c-2', survey_link: 'https://www.surveymonkey.com/r/other' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    proxyRequestMock
      .mockReset()
      .mockImplementation(async (_req: Request, _svc: string, path: string) =>
        path.endsWith('/responses') ? { data: rows, meta: { page_token: '' } } : survey
      );
    service = new SurveyService();
    checkAccessSpy = vi.spyOn(AccessCheckService.prototype, 'checkAccess');
  });

  afterEach(() => {
    checkAccessSpy.mockRestore();
  });

  it('keeps allowlisted links only on rows of committees in projects the caller writes', async () => {
    checkAccessSpy.mockResolvedValue(
      new Map([
        ['p-1#writer_guard', true],
        ['p-2#writer_guard', false],
      ])
    );

    const page = await service.getSurveyResponses(req, 's-1', {});

    expect(checkAccessSpy).toHaveBeenCalledWith(req, [
      { resource: 'project', id: 'p-1', access: 'writer_guard' },
      { resource: 'project', id: 'p-2', access: 'writer_guard' },
    ]);
    expect(page.data).toEqual([
      { id: 'r-1', committee_uid: 'c-1', survey_link: 'https://www.surveymonkey.com/r/abc' },
      { id: 'r-2', committee_uid: 'c-1' },
      { id: 'r-3', committee_uid: 'c-2' },
    ]);
    expect(page.meta.page_token).toBeUndefined();
  });

  it('strips every link when the survey lookup fails', async () => {
    proxyRequestMock.mockImplementation(async (_req: Request, _svc: string, path: string) => {
      if (path.endsWith('/responses')) return { data: rows, meta: {} };
      throw new Error('upstream down');
    });

    const page = await service.getSurveyResponses(req, 's-1', {});

    expect(page.data.every((r) => r.survey_link === undefined)).toBe(true);
  });
});

describe('SurveyService follow-up actions (#4340)', () => {
  let service: SurveyService;
  let checkAccessSpy: MockInstance<AccessCheckService['checkAccess']>;
  const req = { path: '/api/surveys/s-1/resync', bearerToken: 'caller-token' } as Request;
  // Multi-foundation survey: the caller writes p-1 (committee c-1) but not p-2 (c-2).
  const survey = {
    committees: [
      { committee_uid: 'c-1', project_uid: 'p-1' },
      { committee_uid: 'c-2', project_uid: 'p-2' },
    ],
  };
  const responses = [
    { id: 'r-1', committee_uid: 'c-1' },
    { id: 'r-2', committee_uid: 'c-2' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    proxyRequestMock.mockReset().mockImplementation(async (_req: Request, _svc: string, path: string, method: string) => {
      if (method !== 'GET') return undefined;
      if (path === '/surveys/s-1') return survey;
      if (path === '/surveys/s-1/responses') return { data: responses, meta: { page_token: '' } };
      return { affected_recipients: null };
    });
    service = new SurveyService();
    checkAccessSpy = vi.spyOn(AccessCheckService.prototype, 'checkAccess').mockResolvedValue(
      new Map([
        ['p-1#writer_guard', true],
        ['p-2#writer_guard', false],
      ])
    );
  });

  afterEach(() => {
    checkAccessSpy.mockRestore();
  });

  const writes = () => proxyRequestMock.mock.calls.filter((call) => call[3] === 'POST');

  it('sends reminders through bulk_resend for recipients of managed committees', async () => {
    const result = await service.sendSurveyReminders(req, 's-1', ['r-1']);

    expect(writes()).toEqual([[req, 'LFX_V2_SERVICE', '/surveys/s-1/bulk_resend', 'POST', undefined, { recipient_ids: ['r-1'] }]]);
    expect(result).toEqual({ recipient_count: 1 });
  });

  it.each([[['r-1', 'r-2']], [['r-unknown']]])('refuses reminders naming %j and sends nothing', async (ids) => {
    await expect(service.sendSurveyReminders(req, 's-1', ids)).rejects.toMatchObject({ statusCode: 403, code: 'SURVEY_RECIPIENT_NOT_MANAGED' });
    expect(writes()).toEqual([]);
  });

  it('resyncs a managed committee with committee_uid as a query param', async () => {
    await service.resyncRecipients(req, 's-1', 'c-1');

    expect(writes()).toEqual([[req, 'LFX_V2_SERVICE', '/surveys/s-1/send_missing_recipients', 'POST', { committee_uid: 'c-1' }]]);
  });

  it.each([['c-2'], [undefined]])('refuses a resync scoped to %s when the caller does not manage it all', async (committeeUid) => {
    await expect(service.resyncRecipients(req, 's-1', committeeUid)).rejects.toMatchObject({ statusCode: 403, code: 'SURVEY_COMMITTEE_NOT_MANAGED' });
    await expect(service.getResyncPreview(req, 's-1', committeeUid)).rejects.toMatchObject({ statusCode: 403 });
    expect(writes()).toEqual([]);
    expect(proxyRequestMock.mock.calls.some((call) => call[2] === '/surveys/s-1/preview_send')).toBe(false);
  });

  it('allows a whole-survey resync when the caller manages every committee, and normalizes the preview', async () => {
    checkAccessSpy.mockResolvedValue(
      new Map([
        ['p-1#writer_guard', true],
        ['p-2#writer_guard', true],
      ])
    );

    const preview = await service.getResyncPreview(req, 's-1');

    expect(proxyRequestMock).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/surveys/s-1/preview_send', 'GET', undefined);
    expect(preview).toEqual({ affected_recipients: [], affected_committees: [] });
  });
});
