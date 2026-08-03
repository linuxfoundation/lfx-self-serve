// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Project } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SLUG = 'cncf';
const PROJECT_UID = 'project-2222';

// Hoisted, per-test-controllable mocks. The `@lfx-one/shared/*` path alias isn't wired
// into vitest (see vitest.config.ts), so the shared barrels the controller imports at
// module load are stubbed here. `computeIsFoundation` is mocked so each test can drive
// the foundation-vs-project branch without constructing a full Project graph.
const { computeIsFoundationMock, generateM2MTokenMock, projectSvc } = vi.hoisted(() => ({
  computeIsFoundationMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
  projectSvc: {
    getProjectIdBySlug: vi.fn(),
    getProjectById: vi.fn(),
  },
}));

vi.mock('@lfx-one/shared/utils', () => ({
  computeIsFoundation: computeIsFoundationMock,
  isFileTypeAllowed: vi.fn(),
  isUuid: vi.fn(),
}));
vi.mock('@lfx-one/shared/constants', () => ({
  ALLOWED_FILE_TYPES: [],
  LENS_REDIRECT_RESOURCES: new Set<string>(['votes', 'meetings', 'mailing-lists', 'groups', 'documents', 'surveys', 'newsletters', 'settings']),
}));
vi.mock('@lfx-one/shared/enums', () => ({ MeetingVisibility: { PUBLIC: 'public', PRIVATE: 'private' } }));
// validation.helper pulls in a heavy shared/constants + shared/enums graph; stub it
// wholesale so only the controller's getLensRedirect path loads.
vi.mock('../helpers/validation.helper', () => ({ getStringQueryParam: vi.fn(), validateUidParameter: vi.fn(() => true) }));

vi.mock('../services/project.service', () => ({
  ProjectService: vi.fn(function () {
    return projectSvc;
  }),
}));
vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return {};
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
