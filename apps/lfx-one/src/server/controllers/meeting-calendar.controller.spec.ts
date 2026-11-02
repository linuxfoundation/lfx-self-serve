// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The real ICS util transitively loads @angular/common/http, which needs the JIT compiler under Vitest.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MEETING_ID = '92867066227';

const { meetingSvc } = vi.hoisted(() => ({ meetingSvc: { getMeetingById: vi.fn() } }));

// The `@lfx-one/shared/*` alias isn't wired into vitest: point the barrel at the real implementation files.
vi.mock('@lfx-one/shared/utils', async () => await import('../../../../../packages/shared/src/utils/meeting-ics.utils'));
vi.mock('../helpers/validation.helper', () => ({
  validateUidParameter: vi.fn(() => true),
  getStringQueryParam: vi.fn((req: Request, name: string) => (typeof req.query[name] === 'string' ? (req.query[name] as string) : undefined)),
}));
vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return meetingSvc;
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../errors', () => ({
  ResourceNotFoundError: class extends Error {
    public readonly statusCode = 404;
  },
}));

const { MeetingCalendarController } = await import('./meeting-calendar.controller');
const { validateUidParameter } = await import('../helpers/validation.helper');

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    status: vi.fn(() => res),
    send: vi.fn(),
  };
  return { res: res as unknown as Response & typeof res, headers };
}

function makeReq(query: Record<string, string> = {}): Request {
  return { params: { uid: MEETING_ID }, query } as unknown as Request;
}

/** A payload carrying everything that must NOT reach the file. */
const SENSITIVE_MEETING = {
  id: MEETING_ID,
  title: 'Technical Steering Committee',
  project_name: 'Example Project',
  start_time: '2026-11-05T19:00:00Z',
  duration: 60,
  timezone: 'America/Los_Angeles',
  description: 'Join https://zoom.us/j/123456789?pwd=SECRETPWD passcode 998877',
  password: 'meetingpass',
  host_key: '123456',
  join_url: 'https://zoom.us/j/123456789?pwd=SECRETPWD',
  zoom_config: { meeting_id: '123456789', passcode: 'zoompass' },
  registrants: [{ email: 'guest@example.com', first_name: 'Guest' }],
  occurrences: [],
};

describe('MeetingCalendarController.getMeetingCalendarIcs', () => {
  const controller = new MeetingCalendarController();
  const next = vi.fn() as unknown as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T20:00:00Z'));
    process.env['PCC_BASE_URL'] = 'https://app.lfx.dev/some/path';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env['PCC_BASE_URL'];
  });

  it('serves a parseable text/calendar attachment with the page URL, and fetches under the caller (no access/host-key work)', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(SENSITIVE_MEETING);
    const { res, headers } = makeRes();
    const req = makeReq();

    await controller.getMeetingCalendarIcs(req, res, next);

    expect(meetingSvc.getMeetingById).toHaveBeenCalledWith(req, MEETING_ID, 'v1_meeting', { access: false, includeProject: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(headers['content-disposition']).toContain('attachment; filename="technical-steering-committee.ics"');
    expect(headers['cache-control']).toBe('private, no-store');
    const body = res.send.mock.calls[0][0] as string;
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(body).toContain('DTSTART:20261105T190000Z\r\n');
    expect(body).toContain('DTEND:20261105T200000Z\r\n');
    expect(body).toContain('UID:92867066227@lfx.dev\r\n');
    expect(body).toContain('URL:https://app.lfx.dev/meetings/92867066227\r\n');
    expect(next).not.toHaveBeenCalled();
  });

  it('contains none of the sensitive payload fields', async () => {
    meetingSvc.getMeetingById.mockResolvedValue(SENSITIVE_MEETING);
    const { res } = makeRes();

    await controller.getMeetingCalendarIcs(makeReq(), res, next);

    const body = res.send.mock.calls[0][0] as string;
    for (const forbidden of ['zoom', 'SECRETPWD', '998877', 'meetingpass', '123456', 'zoompass', 'guest@example.com', 'Guest', 'ATTENDEE', 'ORGANIZER']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('exports the next active occurrence of a recurring meeting with an occurrence-specific UID', async () => {
    meetingSvc.getMeetingById.mockResolvedValue({
      ...SENSITIVE_MEETING,
      start_time: '2026-01-01T19:00:00Z',
      occurrences: [
        { occurrence_id: 'old', start_time: '2026-10-29T19:00:00Z', duration: 30 },
        { occurrence_id: 'next', start_time: '2026-11-10T19:00:00Z', duration: 45 },
      ],
    });
    const { res } = makeRes();

    await controller.getMeetingCalendarIcs(makeReq(), res, next);

    const body = res.send.mock.calls[0][0] as string;
    expect(body).toContain('DTSTART:20261110T190000Z');
    expect(body).toContain('DTEND:20261110T194500Z');
    expect(body).toContain('UID:92867066227-next@lfx.dev');
  });

  it('404s a recurring meeting with no remaining occurrence instead of exporting the series start', async () => {
    meetingSvc.getMeetingById.mockResolvedValue({
      ...SENSITIVE_MEETING,
      occurrences: [{ occurrence_id: 'old', start_time: '2026-10-01T19:00:00Z', duration: 30 }],
    });
    const { res } = makeRes();

    await controller.getMeetingCalendarIcs(makeReq(), res, next);

    expect(res.send).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it.each([403, 404])('propagates an upstream %i (caller cannot view / unknown meeting) without sending a body', async (statusCode) => {
    const upstream = Object.assign(new Error('upstream'), { statusCode });
    meetingSvc.getMeetingById.mockRejectedValue(upstream);
    const { res } = makeRes();

    await controller.getMeetingCalendarIcs(makeReq(), res, next);

    expect(next).toHaveBeenCalledWith(upstream);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('stops without fetching when the uid is invalid', async () => {
    vi.mocked(validateUidParameter).mockReturnValueOnce(false);
    const { res } = makeRes();

    await controller.getMeetingCalendarIcs(makeReq(), res, next);

    expect(meetingSvc.getMeetingById).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('builds the page URL from configuration, not the request, and uses the server default when unconfigured', async () => {
    delete process.env['PCC_BASE_URL'];
    meetingSvc.getMeetingById.mockResolvedValue(SENSITIVE_MEETING);
    const { res } = makeRes();
    const req = { ...makeReq(), headers: { host: 'evil.example' } } as unknown as Request;

    await controller.getMeetingCalendarIcs(req, res, next);

    const body = res.send.mock.calls[0][0] as string;
    expect(body).toContain('URL:http://localhost:4000/meetings/92867066227');
    expect(body).not.toContain('evil.example');
  });
});
