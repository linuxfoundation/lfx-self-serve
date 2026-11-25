// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getViewMode: vi.fn(),
  getKpiSummary: vi.fn(),
  getSpendBreakdown: vi.fn(),
  getInfluenceRows: vi.fn(),
}));

vi.mock('../helpers/org-lens-read-access.helper', () => ({
  assertOrgLensRead: vi.fn().mockResolvedValue(undefined),
  getOrgLensViewMode: mocks.getViewMode,
}));
vi.mock('../helpers/org-meetings-range.helper', () => ({ parseOrgMeetingsRange: () => '12m' }));
vi.mock('../helpers/org-uid.helper', () => ({ assertOrgUid: vi.fn() }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), debug: vi.fn(), warning: vi.fn() },
}));
vi.mock('../services/org-lens-meetings.service', () => ({
  OrgLensMeetingsService: class {
    public getKpiSummary = mocks.getKpiSummary;
    public getSpendBreakdown = mocks.getSpendBreakdown;
    public getInfluenceRows = mocks.getInfluenceRows;
  },
}));

const { OrgLensMeetingsController } = await import('./org-lens-meetings.controller');

const req = { params: { orgUid: 'org-1' }, query: { range: '12m' } } as unknown as Request;
const next = vi.fn() as unknown as NextFunction;

function makeRes(): { res: Response; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  return { res: { setHeader: vi.fn(), json } as unknown as Response, json };
}

// A payload that has, hypothetically, picked up person-derived fields.
const leakyKpi = { employeesActive: 7, meetingsAttended: 40, attendeeName: 'Ada Lovelace', contactEmail: 'ada@acme.example' };
const leakySpend = {
  byFoundation: [{ label: 'CNCF', pct: 60, count: 6, participantName: 'Ada' }],
  byProject: [],
  byMeetingType: [],
  byRole: [{ label: 'Maintainer', pct: 10, others: [{ label: 'ada@acme.example' }] }],
};
const leakyInfluence = [{ project: 'Kubernetes', projectSlug: 'k8s', ecosystemInfluence: 5, firstName: 'Ada', breakdown: [] }];

describe('OrgLensMeetingsController employee view redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getKpiSummary.mockResolvedValue(leakyKpi);
    mocks.getSpendBreakdown.mockResolvedValue(leakySpend);
    mocks.getInfluenceRows.mockResolvedValue(leakyInfluence);
  });

  it('strips person-level fields from every endpoint in the employee view, keeping the aggregates', async () => {
    mocks.getViewMode.mockReturnValue('employee');
    const controller = new OrgLensMeetingsController();

    const kpi = makeRes();
    await controller.getKpi(req, kpi.res, next);
    expect(kpi.json).toHaveBeenCalledWith({ employeesActive: 7, meetingsAttended: 40 });

    const spend = makeRes();
    await controller.getSpend(req, spend.res, next);
    expect(spend.json).toHaveBeenCalledWith({
      byFoundation: [{ label: 'CNCF', pct: 60, count: 6 }],
      byProject: [],
      byMeetingType: [],
      byRole: [{ label: 'Maintainer', pct: 10, others: [{}] }],
    });

    const influence = makeRes();
    await controller.getInfluence(req, influence.res, next);
    expect(influence.json).toHaveBeenCalledWith([{ project: 'Kubernetes', projectSlug: 'k8s', ecosystemInfluence: 5, breakdown: [] }]);
  });

  it('leaves the full view payload untouched', async () => {
    mocks.getViewMode.mockReturnValue('full');
    const controller = new OrgLensMeetingsController();

    const kpi = makeRes();
    await controller.getKpi(req, kpi.res, next);
    expect(kpi.json).toHaveBeenCalledWith(leakyKpi);

    const influence = makeRes();
    await controller.getInfluence(req, influence.res, next);
    expect(influence.json).toHaveBeenCalledWith(leakyInfluence);
  });
});
