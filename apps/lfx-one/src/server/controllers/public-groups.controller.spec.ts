// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Committee } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// Per-test-controllable service mocks. The controller constructs `new ProjectService()` and
// `new CommitteeService()` as fields, so the mocked constructors must hand back these same
// objects every time (same pattern as public-profile.controller.spec.ts).
const { getFoundationProjectUidsMock, getProjectByIdMock, getCommitteesMock } = vi.hoisted(() => ({
  getFoundationProjectUidsMock: vi.fn(),
  getProjectByIdMock: vi.fn(),
  getCommitteesMock: vi.fn(),
}));

vi.mock('../services/project.service', () => ({
  ProjectService: vi.fn(function () {
    return {
      getFoundationProjectUids: getFoundationProjectUidsMock,
      getProjectById: getProjectByIdMock,
      getProjectIdBySlug: vi.fn(),
    };
  }),
}));

vi.mock('../services/committee.service', () => ({
  CommitteeService: vi.fn(function () {
    return { getCommittees: getCommitteesMock };
  }),
}));

vi.mock('../services/meeting.service', () => ({
  MeetingService: vi.fn(function () {
    return {};
  }),
}));

vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: vi.fn(function () {
    return {};
  }),
}));

vi.mock('../utils/m2m-token.util', () => ({
  generateM2MToken: vi.fn(async () => 'm2m-token'),
}));

// meeting.utils.ts statically imports HttpParams from @angular/common/http, which crashes JIT
// compilation under plain-Node vitest (no @angular/compiler loaded). getPublicGroupsByFoundation
// never calls buildCommitteeCadenceSummary (only getPublicGroupById does), so a stub is sufficient
// and keeps this spec from depending on an unrelated Angular-runtime constraint.
vi.mock('@lfx-one/shared/utils/meeting.utils', () => ({
  buildCommitteeCadenceSummary: vi.fn(() => ''),
}));

// validation.helper.ts imports `resolvePeriodRange` from the `@lfx-one/shared/utils` barrel, which
// transitively pulls in form.utils.ts/vote.utils.ts/social-listening-filter.utils.ts — all of which
// statically import Angular browser packages (GH-2381). getPublicGroupsByFoundation never calls
// validateUidParameter (only getPublicGroupById does), so a stub is sufficient here too.
vi.mock('../helpers/validation.helper', () => ({
  validateUidParameter: vi.fn(() => true),
}));

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { PublicGroupsController } from './public-groups.controller';

function buildReqRes(identifier: string): { req: Request; res: Response & { json: Mock }; next: NextFunction & Mock } {
  const req = { params: { identifier }, path: `/public/api/foundations/${identifier}/groups`, log: {} } as unknown as Request;
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response & { json: Mock };
  const next = vi.fn() as unknown as NextFunction & Mock;
  return { req, res, next };
}

function committee(uid: string, projectUid: string): Committee {
  return { uid, name: `Committee ${uid}`, public: true, project_uid: projectUid } as Committee;
}

describe('PublicGroupsController.getPublicGroupsByFoundation — fan-out cap', () => {
  let controller: PublicGroupsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PublicGroupsController();
    getProjectByIdMock.mockImplementation(async (_req: Request, uid: string) => ({ uid, name: uid, slug: uid }));
    getCommitteesMock.mockResolvedValue([]);
  });

  it('does not truncate and omits `truncated` from the response when childUids is under the cap', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    getFoundationProjectUidsMock.mockResolvedValue(['project-1', 'project-2']);
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.truncated).toBeUndefined();
    // Every discovered UID (foundation excluded — it's not in childUids) is queried, none dropped.
    expect(getCommitteesMock).toHaveBeenCalledTimes(2);
  });

  it('truncates, sets `truncated: true`, and pins the foundationUid so it always survives the cap', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    // 200 UIDs including the foundation's own UID, none pre-sorted — well over the 150 cap.
    // foundationUid is deliberately placed late/high alphabetically so a naive sort-then-slice
    // would drop it (the exact regression Copilot + Cursor Bugbot flagged).
    const childUids = [foundationUid, ...Array.from({ length: 199 }, (_, i) => `zzz-project-${i}`)];
    getFoundationProjectUidsMock.mockResolvedValue(childUids);
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.truncated).toBe(true);

    // Exactly 150 UIDs were queried (the cap), and the foundation's own UID is one of them.
    expect(getCommitteesMock).toHaveBeenCalledTimes(150);
    const queriedUids = getCommitteesMock.mock.calls.map((call) => (call[1].tags as string).replace('project_uid:', ''));
    expect(queriedUids).toContain(foundationUid);
    expect(new Set(queriedUids).size).toBe(150);
  });

  it('deduplicates public committees returned for multiple projects and excludes non-public ones', async () => {
    const foundationUid = '11111111-1111-4111-8111-111111111111';
    getFoundationProjectUidsMock.mockResolvedValue(['project-1', 'project-2']);
    getCommitteesMock.mockImplementation(async (_req: Request, params: { tags: string }) => {
      if (params.tags === 'project_uid:project-1') {
        return [committee('shared-committee', 'project-1'), { ...committee('private-committee', 'project-1'), public: false }];
      }
      return [committee('shared-committee', 'project-2')];
    });
    const { req, res, next } = buildReqRes(foundationUid);

    await controller.getPublicGroupsByFoundation(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = res.json.mock.calls[0][0];
    expect(response.groups).toHaveLength(1);
    expect(response.total).toBe(1);
  });
});
