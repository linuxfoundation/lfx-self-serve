// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Meeting, Project } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SLUG = 'cncf';
const PROJECT_UID = 'project-2222';

// Hoisted, per-test-controllable mocks. The `@lfx-one/shared/*` path alias isn't wired
// into vitest (see vitest.config.ts), so the shared barrels the controller imports at
// module load are stubbed here. `computeIsFoundation` is mocked so each test can drive
// the foundation-vs-project branch without constructing a full Project graph.
const { computeIsFoundationMock, generateM2MTokenMock, isUuidMock, meetingSvc, projectSvc, committeeSvc } = vi.hoisted(() => ({
  computeIsFoundationMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
  isUuidMock: vi.fn(),
  meetingSvc: {
    getMeetings: vi.fn(),
  },
  committeeSvc: {
    getCommittees: vi.fn(),
  },
  projectSvc: {
    getProjectIdBySlug: vi.fn(),
    getProjectById: vi.fn(),
    getProjectBySlug: vi.fn(),
    getProjectSlugs: vi.fn(),
  },
}));

vi.mock('@lfx-one/shared/utils', () => ({
  computeIsFoundation: computeIsFoundationMock,
  isFileTypeAllowed: vi.fn(),
  isUuid: isUuidMock,
}));
vi.mock('@lfx-one/shared/constants', async () => {
  // Deep-import the real allowlist so the drift guard below asserts the production
  // value, not a hardcoded copy that can drift. The barrel is mocked because it
  // re-exports Angular-dependent constants; `lens.constants.ts` itself only has a
  // type-only import from `../interfaces`, so importing it directly is safe.
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/lens.constants')>(
    '../../../../../packages/shared/src/constants/lens.constants'
  );
  return {
    ALLOWED_FILE_TYPES: [],
    LENS_REDIRECT_RESOURCES: actual.LENS_REDIRECT_RESOURCES,
  };
});
vi.mock('@lfx-one/shared/enums', () => ({ MeetingVisibility: { PUBLIC: 'public', PRIVATE: 'private' } }));
// validation.helper pulls in a heavy shared/constants + shared/enums graph; stub it
// wholesale so only the controller's getLensRedirect path loads.
vi.mock('../helpers/validation.helper', () => ({
  getStringQueryParam: vi.fn((req: any, key: string) => (typeof req.query?.[key] === 'string' ? req.query[key] : undefined)),
  validateUidParameter: vi.fn(() => true),
}));

vi.mock('../services/project.service', () => ({
  ProjectService: vi.fn(function () {
    return projectSvc;
  }),
}));
vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return meetingSvc;
  }),
}));
vi.mock('../services/committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return committeeSvc;
  }),
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveEmail: vi.fn(), getEffectiveUsername: vi.fn(), getUsernameFromAuth: vi.fn() }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: generateM2MTokenMock }));

import { readFileSync } from 'node:fs';

import { LENS_REDIRECT_RESOURCES } from '@lfx-one/shared/constants';
import { ProjectController } from './project.controller';
import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    uid: PROJECT_UID,
    slug: SLUG,
    name: 'CNCF',
    description: '',
    public: true,
    parent_uid: '',
    stage: 'Active',
    category: '',
    funding_model: ['Membership'],
    charter_url: '',
    legal_entity_type: 'Foundation',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '',
    updated_at: '',
    mailing_list_count: 0,
    ...overrides,
  } as Project;
}

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meeting-1',
    project_uid: PROJECT_UID,
    visibility: 'public',
    restricted: false,
    committees: [],
    start_time: new Date().toISOString(),
    duration: 60,
    timezone: 'America/New_York',
    title: 'Meeting',
    description: '',
    created_by: { name: 'Organizer', email: 'organizer@example.com' },
    owner: { name: 'Owner', email: 'owner@example.com' },
    // Seeded so the public-feed tests assert these never reach an anonymous caller.
    organizers: ['organizer-lfid'],
    password: 'super-secret',
    passcode: '123456',
    host_key: '654321',
    zoom_config: { meeting_id: '99152950841', passcode: '123456' },
    ...overrides,
  } as Meeting;
}

function buildMeetingsReqRes(id: string = PROJECT_UID, query: Record<string, string> = {}) {
  const req = {
    params: { id },
    query,
    headers: {},
    bearerToken: undefined,
    path: `/public/api/projects/${id}/meetings`,
  } as any;
  const res = { json: vi.fn(), setHeader: vi.fn() } as any;
  const next = vi.fn();
  return { req, res, next };
}

function buildReqRes(slug: string = SLUG, resource: string = 'votes') {
  const req = {
    params: { slug, resource },
    query: {},
    headers: {},
    bearerToken: undefined,
    path: `/public/api/projects/${slug}/lens-redirect/${resource}`,
  } as any;
  const res = {
    redirect: vi.fn(),
    setHeader: vi.fn(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe('ProjectController.getLensRedirect', () => {
  let controller: ProjectController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProjectController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
  });

  it('redirects a foundation slug to /foundation/<resource>', async () => {
    projectSvc.getProjectIdBySlug.mockResolvedValue({ uid: PROJECT_UID, slug: SLUG, exists: true });
    projectSvc.getProjectById.mockResolvedValue(buildProject());
    computeIsFoundationMock.mockReturnValue(true);
    const { req, res, next } = buildReqRes();

    await controller.getLensRedirect(req, res, next);

    expect(generateM2MTokenMock).toHaveBeenCalledTimes(1);
    expect(projectSvc.getProjectById).toHaveBeenCalledWith(req, PROJECT_UID, false);
    expect(res.redirect).toHaveBeenCalledWith(302, '/foundation/votes?project=cncf');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects a project slug to /project/<resource>', async () => {
    projectSvc.getProjectIdBySlug.mockResolvedValue({ uid: PROJECT_UID, slug: SLUG, exists: true });
    projectSvc.getProjectById.mockResolvedValue(buildProject());
    computeIsFoundationMock.mockReturnValue(false);
    const { req, res, next } = buildReqRes();

    await controller.getLensRedirect(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(302, '/project/votes?project=cncf');
    expect(next).not.toHaveBeenCalled();
  });

  it('carries the resource segment through to the lens-prefixed destination', async () => {
    projectSvc.getProjectIdBySlug.mockResolvedValue({ uid: PROJECT_UID, slug: SLUG, exists: true });
    projectSvc.getProjectById.mockResolvedValue(buildProject());
    computeIsFoundationMock.mockReturnValue(true);
    const { req, res, next } = buildReqRes(SLUG, 'meetings');

    await controller.getLensRedirect(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(302, '/foundation/meetings?project=cncf');
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to the flat resource route when the slug is unresolvable', async () => {
    projectSvc.getProjectIdBySlug.mockResolvedValue({ uid: '', slug: SLUG, exists: false });
    const { req, res, next } = buildReqRes(SLUG, 'meetings');

    await controller.getLensRedirect(req, res, next);

    expect(projectSvc.getProjectById).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(302, '/meetings?project=cncf');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to the flat resource route when the project fetch throws', async () => {
    projectSvc.getProjectIdBySlug.mockResolvedValue({ uid: PROJECT_UID, slug: SLUG, exists: true });
    projectSvc.getProjectById.mockRejectedValue(new Error('upstream 503'));
    computeIsFoundationMock.mockReturnValue(true);
    const { req, res, next } = buildReqRes();

    await controller.getLensRedirect(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(302, '/votes?project=cncf');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid slug via next() without an M2M call', async () => {
    const { req, res, next } = buildReqRes('bad slug!');

    await controller.getLensRedirect(req, res, next);

    expect(generateM2MTokenMock).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('rejects an unsupported resource via next() without an M2M call', async () => {
    const { req, res, next } = buildReqRes(SLUG, 'evil-open-redirect');

    await controller.getLensRedirect(req, res, next);

    expect(generateM2MTokenMock).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('passes hyphens and underscores through verbatim in the redirect location', async () => {
    const slug = 'my-project_1';
    projectSvc.getProjectIdBySlug.mockResolvedValue({ uid: PROJECT_UID, slug, exists: true });
    projectSvc.getProjectById.mockResolvedValue(buildProject({ slug }));
    computeIsFoundationMock.mockReturnValue(false);
    const { req, res, next } = buildReqRes(slug);

    await controller.getLensRedirect(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(302, '/project/votes?project=my-project_1');
  });
});

describe('ProjectController.getProjectSlugs', () => {
  let controller: ProjectController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProjectController();
  });

  it('responds with the slug array, logs success, and does not call next()', async () => {
    const slugs = ['cncf', 'kubernetes', 'linux'];
    projectSvc.getProjectSlugs.mockResolvedValue(slugs);
    const req = { headers: {}, bearerToken: undefined, method: 'GET' } as any;
    const res = { json: vi.fn() } as any;
    const next = vi.fn();

    await controller.getProjectSlugs(req, res, next);

    expect(res.json).toHaveBeenCalledWith(slugs);
    expect(logger.startOperation).toHaveBeenCalledWith(req, 'get_project_slugs');
    expect(logger.success).toHaveBeenCalledWith(req, 'get_project_slugs', 0, { slug_count: 3 });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards errors to next() without calling res.json', async () => {
    const boom = new Error('upstream-down');
    projectSvc.getProjectSlugs.mockRejectedValue(boom);
    const req = { headers: {}, bearerToken: undefined, method: 'GET' } as any;
    const res = { json: vi.fn() } as any;
    const next = vi.fn();

    await controller.getProjectSlugs(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('ProjectController.getProjectBySlug', () => {
  let controller: ProjectController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProjectController();
  });

  function buildSlugReqRes(slug: string, query: Record<string, string> = {}) {
    const req = { params: { slug }, query, headers: {}, bearerToken: undefined, method: 'GET' } as any;
    const res = { json: vi.fn() } as any;
    const next = vi.fn();
    return { req, res, next };
  }

  it('fetches by id, forwards the meeting_coordinator/auditor query flags, and logs success', async () => {
    isUuidMock.mockReturnValue(true);
    const project = buildProject();
    projectSvc.getProjectById.mockResolvedValue(project);
    const { req, res, next } = buildSlugReqRes(PROJECT_UID, { meeting_coordinator: 'true', auditor: 'true' });

    await controller.getProjectBySlug(req, res, next);

    expect(projectSvc.getProjectById).toHaveBeenCalledWith(req, PROJECT_UID, true, true, true);
    expect(projectSvc.getProjectBySlug).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(project);
    expect(logger.success).toHaveBeenCalledWith(req, 'get_project_by_slug', 0, { slug: PROJECT_UID, project_uid: project.uid });
    expect(next).not.toHaveBeenCalled();
  });

  it('fetches by slug when not a uuid, defaulting the flags to false when the query params are absent', async () => {
    isUuidMock.mockReturnValue(false);
    const project = buildProject();
    projectSvc.getProjectBySlug.mockResolvedValue(project);
    const { req, res, next } = buildSlugReqRes(SLUG);

    await controller.getProjectBySlug(req, res, next);

    expect(projectSvc.getProjectBySlug).toHaveBeenCalledWith(req, SLUG, false, false);
    expect(projectSvc.getProjectById).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(project);
    expect(logger.success).toHaveBeenCalledWith(req, 'get_project_by_slug', 0, { slug: SLUG, project_uid: project.uid });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards errors to next() without calling res.json', async () => {
    isUuidMock.mockReturnValue(false);
    const boom = new Error('upstream-down');
    projectSvc.getProjectBySlug.mockRejectedValue(boom);
    const { req, res, next } = buildSlugReqRes(SLUG);

    await controller.getProjectBySlug(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('ProjectController.getProjectCalendar', () => {
  let controller: ProjectController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProjectController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    meetingSvc.getMeetings.mockResolvedValue({ data: [], page_token: undefined });
  });

  function buildCalendarReqRes(id: string = PROJECT_UID) {
    const req = { params: { id }, headers: {}, bearerToken: undefined, path: `/public/api/projects/${id}/calendar.ics` } as any;
    const res = { send: vi.fn(), setHeader: vi.fn() } as any;
    const next = vi.fn();
    return { req, res, next };
  }

  it('includes X-WR-CALNAME when the project name resolves', async () => {
    projectSvc.getProjectById.mockResolvedValue(buildProject({ name: 'CNCF' }));
    const { req, res, next } = buildCalendarReqRes();

    await controller.getProjectCalendar(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const ics = res.send.mock.calls[0][0] as string;
    expect(ics).toContain('X-WR-CALNAME:CNCF');
  });

  it('falls back to an unnamed calendar (200, no X-WR-CALNAME) when the project name lookup fails', async () => {
    projectSvc.getProjectById.mockRejectedValue(new Error('upstream 503'));
    const { req, res, next } = buildCalendarReqRes();

    await controller.getProjectCalendar(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const ics = res.send.mock.calls[0][0] as string;
    expect(ics).not.toContain('X-WR-CALNAME');
    expect(ics).toContain('BEGIN:VCALENDAR');
  });
});

describe('ProjectController.getProjectMeetings', () => {
  let controller: ProjectController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProjectController();
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    isUuidMock.mockImplementation((value: string) => value === PROJECT_UID || value === 'committee-uid-1234');
    projectSvc.getProjectById.mockResolvedValue(buildProject());
    meetingSvc.getMeetings.mockResolvedValue({ data: [], page_token: undefined });
    // Default: both fixture committees are publicly listed, so tests that are not about visibility
    // filtering see every association pass through.
    committeeSvc.getCommittees.mockResolvedValue([
      { uid: 'committee-uid-1234', name: 'Private Security Committee', public: true },
      { uid: 'committee-uid-5678', name: 'Board', public: true },
    ]);
  });

  it('returns only allowlisted calendar fields and the project envelope', async () => {
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({ data: resourceType === 'v1_meeting' ? [buildMeeting()] : [], page_token: undefined })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    const response = res.json.mock.calls[0][0];
    expect(response.meetings).toHaveLength(1);
    // Exact key set, not a list of absent keys — a delete-based strip would pass an "is X absent"
    // check for every field named here while still shipping the next sensitive field added upstream.
    expect(Object.keys(response.meetings[0]).sort()).toEqual(
      [
        'cancelled_occurrences',
        'committee_uids',
        'duration',
        'id',
        'meeting_and_occurrence_id',
        'occurrences',
        'scheduled_start_time',
        'start_time',
        'timezone',
        'title',
      ].sort()
    );
    expect(response.total).toBe(1);
    expect(response.project).toEqual({ uid: PROJECT_UID, name: 'CNCF' });
  });

  it('never serializes credentials or organizer PII to anonymous callers', async () => {
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({ data: resourceType === 'v1_meeting' ? [buildMeeting()] : [], page_token: undefined })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    // Serialized, not just key-checked — `password` on a nested object (e.g. zoom_config) would
    // still be on the wire while every top-level property assertion passed.
    const serialized = JSON.stringify(res.json.mock.calls[0][0]);
    for (const secret of ['super-secret', '123456', '654321', 'organizer@example.com', 'owner@example.com', 'organizer-lfid']) {
      expect(serialized).not.toContain(secret);
    }
    for (const key of ['password', 'passcode', 'host_key', 'zoom_config', 'organizers', 'created_by', 'owner']) {
      expect(serialized).not.toContain(key);
    }
  });

  it('publishes committee UIDs but never committee names', async () => {
    // The UID is opaque and already part of the `?committee=` contract; the name is not, so the client
    // resolves labels from the public group directory instead of trusting this payload.
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({
        data:
          resourceType === 'v1_meeting'
            ? [
                buildMeeting({
                  committees: [
                    { uid: 'committee-uid-1234', name: 'Private Security Committee' },
                    { uid: 'committee-uid-5678', name: 'Board' },
                  ],
                }),
              ]
            : [],
        page_token: undefined,
      })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    expect(res.json.mock.calls[0][0].meetings[0].committee_uids).toEqual(['committee-uid-1234', 'committee-uid-5678']);
    const serialized = JSON.stringify(res.json.mock.calls[0][0]);
    expect(serialized).not.toContain('Private Security Committee');
    expect(serialized).not.toContain('Board');
  });

  it('drops committee entries with no UID and collapses duplicates', async () => {
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({
        data:
          resourceType === 'v1_meeting'
            ? [buildMeeting({ committees: [{ uid: 'committee-uid-1234' }, { uid: 'committee-uid-1234' }, { uid: '' }] as any })]
            : [],
        page_token: undefined,
      })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    expect(res.json.mock.calls[0][0].meetings[0].committee_uids).toEqual(['committee-uid-1234']);
  });

  // The UID of a committee the directory withholds is itself disclosive: it lets an anonymous caller
  // group meetings by a hidden committee, and hand that UID to other anonymous committee endpoints.
  it('withholds UIDs of committees the public directory does not list', async () => {
    committeeSvc.getCommittees.mockResolvedValue([
      { uid: 'committee-uid-1234', name: 'Private Security Committee', public: false },
      { uid: 'committee-uid-5678', name: 'Board', public: true },
    ]);
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({
        data: resourceType === 'v1_meeting' ? [buildMeeting({ committees: [{ uid: 'committee-uid-1234' }, { uid: 'committee-uid-5678' }] as any })] : [],
        page_token: undefined,
      })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    expect(res.json.mock.calls[0][0].meetings[0].committee_uids).toEqual(['committee-uid-5678']);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('committee-uid-1234');
  });

  it('fails closed on a committee lookup error, publishing no UIDs rather than every association', async () => {
    committeeSvc.getCommittees.mockRejectedValue(new Error('committee service 503'));
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({
        data: resourceType === 'v1_meeting' ? [buildMeeting({ committees: [{ uid: 'committee-uid-1234' }] as any })] : [],
        page_token: undefined,
      })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    // Still a 200 with the calendar — the outage costs attribution, not the feed.
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].meetings).toHaveLength(1);
    expect(res.json.mock.calls[0][0].meetings[0].committee_uids).toEqual([]);
  });

  it('returns no meetings when filtered by a committee the public directory does not list', async () => {
    committeeSvc.getCommittees.mockResolvedValue([{ uid: 'committee-uid-5678', name: 'Board', public: true }]);
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({ data: resourceType === 'v1_meeting' ? [buildMeeting()] : [], page_token: undefined })
    );
    const { req, res, next } = buildMeetingsReqRes(PROJECT_UID, { committee: 'committee-uid-1234' });

    await controller.getProjectMeetings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.meetings).toEqual([]);
    expect(response.total).toBe(0);
    // The project envelope still resolves, so the page renders its header rather than an error state.
    expect(response.project.uid).toBe(PROJECT_UID);
  });

  it('projects occurrences down to timestamps and status, dropping per-occurrence titles', async () => {
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({
        data:
          resourceType === 'v1_meeting'
            ? [
                buildMeeting({
                  occurrences: [
                    { occurrence_id: '1630560600', start_time: '2026-09-01T15:00:00Z', duration: 30, status: 'available', title: 'Internal agenda' } as any,
                  ],
                }),
              ]
            : [],
        page_token: undefined,
      })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    const [occurrence] = res.json.mock.calls[0][0].meetings[0].occurrences;
    expect(occurrence).toEqual({ occurrence_id: '1630560600', start_time: '2026-09-01T15:00:00Z', duration: 30, status: 'available' });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('Internal agenda');
  });

  it('resolves an occurrence with no duration override to the series duration', async () => {
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({
        data:
          resourceType === 'v1_meeting'
            ? [buildMeeting({ duration: 90, occurrences: [{ occurrence_id: '1630560600', start_time: '2026-09-01T15:00:00Z' } as any] })]
            : [],
        page_token: undefined,
      })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    // MeetingOccurrenceSummary types duration as required — an undefined on the wire would make the
    // client mapper compute a NaN past-state and a silent 60-minute end time.
    expect(res.json.mock.calls[0][0].meetings[0].occurrences[0].duration).toBe(90);
  });

  it('sets a public Cache-Control on the JSON feed', async () => {
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
  });

  it('still returns meetings with an empty project name when project metadata lookup fails', async () => {
    projectSvc.getProjectById.mockRejectedValue(new Error('upstream 503'));
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({ data: resourceType === 'v1_meeting' ? [buildMeeting()] : [], page_token: undefined })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.meetings).toHaveLength(1);
    expect(response.project).toEqual({ uid: PROJECT_UID, name: '' });
  });

  it('filters out PRIVATE meetings from the public feed', async () => {
    meetingSvc.getMeetings.mockImplementation((_req: any, _query: any, resourceType: string) =>
      Promise.resolve({ data: resourceType === 'v1_meeting' ? [buildMeeting({ id: 'private-1', visibility: 'private' as any })] : [], page_token: undefined })
    );
    const { req, res, next } = buildMeetingsReqRes();

    await controller.getProjectMeetings(req, res, next);

    const response = res.json.mock.calls[0][0];
    expect(response.meetings).toHaveLength(0);
  });

  it('resolves a slug identifier to a UID before querying meetings', async () => {
    isUuidMock.mockReturnValue(false);
    projectSvc.getProjectIdBySlug.mockResolvedValue({ uid: PROJECT_UID, slug: SLUG, exists: true });
    const { req, res, next } = buildMeetingsReqRes(SLUG);

    await controller.getProjectMeetings(req, res, next);

    expect(projectSvc.getProjectIdBySlug).toHaveBeenCalledWith(req, SLUG);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('passes next() a not-found error when the slug is unresolvable', async () => {
    isUuidMock.mockReturnValue(false);
    projectSvc.getProjectIdBySlug.mockResolvedValue({ uid: '', slug: SLUG, exists: false });
    const { req, res, next } = buildMeetingsReqRes(SLUG);

    await controller.getProjectMeetings(req, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses tags_all with both project and committee tags when committee query param is a valid UUID', async () => {
    const { req, res, next } = buildMeetingsReqRes(PROJECT_UID, { committee: 'committee-uid-1234' });

    await controller.getProjectMeetings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const [, query] = meetingSvc.getMeetings.mock.calls[0];
    expect(query).toEqual({ tags_all: [`project_uid:${PROJECT_UID}`, 'committee_uid:committee-uid-1234'] });
  });

  it('rejects an invalid committee query param via next() without calling meeting service', async () => {
    const { req, res, next } = buildMeetingsReqRes(PROJECT_UID, { committee: 'not-a-uuid' });

    await controller.getProjectMeetings(req, res, next);

    expect(meetingSvc.getMeetings).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('rejects an invalid project id via next() without an M2M call', async () => {
    const { req, res, next } = buildMeetingsReqRes('bad id!');

    await controller.getProjectMeetings(req, res, next);

    expect(generateM2MTokenMock).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });
});

describe('LENS_REDIRECT_RESOURCES drift guard', () => {
  // Every allowlisted resource must have both a /foundation/<x> and /project/<x> route,
  // otherwise the redirect would 302 to a 404. Read the real route table as text (mocking
  // it would defeat the check) and assert both lens variants exist for each entry.
  const routesSrc = readFileSync(new URL('../../app/app.routes.ts', import.meta.url), 'utf8');

  it.each([...LENS_REDIRECT_RESOURCES])('resource "%s" has both foundation and project routes', (resource) => {
    expect(routesSrc).toContain(`foundation/${resource}`);
    expect(routesSrc).toContain(`project/${resource}`);
  });
});
