// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_EVENTS_PAGE_SIZE, MAX_SNOWFLAKE_PAGINATION_PAGE } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { getMyEvents, getEvents, getVisaRequests, getTravelFundRequests, getEventOrganizations, getAffiliatedProjectSlugs, generateVisaLetter, logger } =
  vi.hoisted(() => ({
    getMyEvents: vi.fn(),
    getEvents: vi.fn(),
    getVisaRequests: vi.fn(),
    getTravelFundRequests: vi.fn(),
    getEventOrganizations: vi.fn(),
    getAffiliatedProjectSlugs: vi.fn(),
    generateVisaLetter: vi.fn(),
    logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
  }));

// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; see validation.helper.spec.ts.
// The real pagination parsing is what runs here.
vi.mock('@lfx-one/shared/utils', () => ({}));
vi.mock('../services/events.service', () => ({
  EventsService: class {
    public getMyEvents = getMyEvents;
    public getEvents = getEvents;
    public getVisaRequests = getVisaRequests;
    public getTravelFundRequests = getTravelFundRequests;
    public getEventOrganizations = getEventOrganizations;
  },
}));
vi.mock('../services/certificate.service', () => ({ CertificateService: class {} }));
vi.mock('../services/visa-letter.service', () => ({
  VisaLetterService: class {
    public generateVisaLetter = generateVisaLetter;
  },
}));
vi.mock('../services/persona-detection.service', () => ({
  PersonaDetectionService: class {
    public getAffiliatedProjectSlugs = getAffiliatedProjectSlugs;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: () => 'user@example.com', getEffectiveName: () => 'User' }));

import { EventsController } from './events.controller';

type Handler = (controller: EventsController, req: Request, res: Response, next: NextFunction) => Promise<void>;

function buildReq(query: Record<string, unknown>): Request {
  return { params: {}, query, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn(), send: vi.fn() } as unknown as Response;
}

// [endpoint, service mock, index of the options argument, handler]
const endpoints: [string, Mock, number, Handler][] = [
  ['getMyEvents', getMyEvents, 2, (c, req, res, next) => c.getMyEvents(req, res, next)],
  ['getEvents', getEvents, 1, (c, req, res, next) => c.getEvents(req, res, next)],
  ['getVisaRequests', getVisaRequests, 2, (c, req, res, next) => c.getVisaRequests(req, res, next)],
  ['getTravelFundRequests', getTravelFundRequests, 2, (c, req, res, next) => c.getTravelFundRequests(req, res, next)],
];

describe('EventsController Foundation scope', () => {
  const controller = new EventsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getEventOrganizations.mockResolvedValue({ data: ['Example Foundation'] });
    getAffiliatedProjectSlugs.mockResolvedValue(['alpha']);
  });

  it.each([
    ['true', true],
    ['false', false],
    [undefined, false],
    ['TRUE', false],
    [['true'], false],
    [true, false],
  ])('parses registeredOnly=%j strictly', async (raw, expected) => {
    const next = vi.fn();
    const res = buildRes();
    await controller.getEventOrganizations(buildReq({ isPast: 'false', registeredOnly: raw }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getEventOrganizations.mock.calls[0][2]).toMatchObject({ isPast: false, registeredOnly: expected });
    expect(res.json).toHaveBeenCalledWith({ data: ['Example Foundation'] });
    if (expected) expect(getAffiliatedProjectSlugs).not.toHaveBeenCalled();
    else expect(getEventOrganizations.mock.calls[0][2].affiliatedProjectSlugs).toEqual(['alpha']);
  });

  it('does not look up affiliations for Past', async () => {
    await controller.getEventOrganizations(buildReq({ isPast: 'true', registeredOnly: 'true', projectName: 'Example Foundation' }), buildRes(), vi.fn());

    expect(getAffiliatedProjectSlugs).not.toHaveBeenCalled();
    expect(getEventOrganizations.mock.calls[0][2]).toMatchObject({ isPast: true, projectName: 'Example Foundation' });
  });
});

describe('EventsController pagination', () => {
  const controller = new EventsController();

  beforeEach(() => {
    vi.clearAllMocks();
    for (const [, serviceMethod] of endpoints) serviceMethod.mockResolvedValue({ data: [], total: 0 });
  });

  it.each(endpoints)('%s: caps an oversized offset and truncates a fractional one before the service', async (_name, serviceMethod, optionsIndex, handler) => {
    const next = vi.fn();

    await handler(controller, buildReq({ offset: '9999999999999999999999999', pageSize: String(MAX_EVENTS_PAGE_SIZE) }), buildRes(), next);
    await handler(controller, buildReq({ offset: '0.5', pageSize: String(MAX_EVENTS_PAGE_SIZE) }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(serviceMethod.mock.calls[0][optionsIndex]).toMatchObject({
      offset: MAX_SNOWFLAKE_PAGINATION_PAGE * MAX_EVENTS_PAGE_SIZE,
      pageSize: MAX_EVENTS_PAGE_SIZE,
    });
    expect(serviceMethod.mock.calls[1][optionsIndex]).toMatchObject({ offset: 0, pageSize: MAX_EVENTS_PAGE_SIZE });
  });
});

describe('EventsController.getVisaLetter', () => {
  const controller = new EventsController();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a missing eventId before calling the service', async () => {
    const next = vi.fn();

    await controller.getVisaLetter(buildReq({}), buildRes(), next);

    expect(generateVisaLetter).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('sends the PDF as an uncached attachment', async () => {
    const pdf = Buffer.from('pdf');
    generateVisaLetter.mockResolvedValue({ pdf, fileName: 'visa-letter-test.pdf' });
    const req = buildReq({ eventId: 'evt-1' });
    const res = buildRes();
    const next = vi.fn();

    await controller.getVisaLetter(req, res, next);

    expect(generateVisaLetter).toHaveBeenCalledWith(req, 'evt-1');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('visa-letter-test.pdf'));
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', pdf.length);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.send).toHaveBeenCalledWith(pdf);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards service errors to the error handler', async () => {
    const error = new Error('manual');
    generateVisaLetter.mockRejectedValue(error);
    const next = vi.fn();

    await controller.getVisaLetter(buildReq({ eventId: 'evt-1' }), buildRes(), next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
