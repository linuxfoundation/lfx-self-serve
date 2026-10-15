// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { OrgClaGroup, OrgClaGroupList } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { sanitizeFoundationSfid } from './org-cla-foundation-pair';

const ORG = '0014100000Te2ovAAB';
const PROJECT = 'a09410000182dD2AAI';
const FOUNDATION = 'a09410000182dFOUND';
const OTHER_FOUNDATION = 'a09410000182dOTHER';

function group(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
  return {
    id: 'signature-uuid-1',
    claGroupName: 'Nimbus Foundation CLA',
    projects: [{ projectName: 'Cascade', projectSfid: PROJECT }],
    pairProjectSfid: PROJECT,
    foundationSfid: FOUNDATION,
    signed: true,
    status: 'signed',
    needsClaManager: false,
    claManagersCount: 1,
    viewerIsClaManager: true,
    ...overrides,
  };
}

function orgClaService(response: OrgClaGroupList | Error): { listClaGroups: ReturnType<typeof vi.fn> } {
  const listClaGroups = vi.fn();
  if (response instanceof Error) {
    listClaGroups.mockRejectedValue(response);
  } else {
    listClaGroups.mockResolvedValue(response);
  }
  return { listClaGroups };
}

// The sanitizer calls `logger.warning(req, ...)` on upstream failure, which routes through
// `req.log.warn`; a bare `{}` stub throws before the fail-closed path can return undefined.
function reqWithLogger(): { request: Request; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  return { request: { log: { warn } } as unknown as Request, warn };
}

const req = reqWithLogger().request;

describe('sanitizeFoundationSfid', () => {
  it('returns the client value when the resolved CLA Group carries the same foundation id', async () => {
    const service = orgClaService({ orgUid: ORG, claGroups: [group()] });

    await expect(sanitizeFoundationSfid(req, service, ORG, PROJECT, FOUNDATION)).resolves.toBe(FOUNDATION);
    expect(service.listClaGroups).toHaveBeenCalledWith(req, ORG);
  });

  it('drops a foundation id that does not match the resolved CLA Group row', async () => {
    const service = orgClaService({ orgUid: ORG, claGroups: [group()] });

    await expect(sanitizeFoundationSfid(req, service, ORG, PROJECT, OTHER_FOUNDATION)).resolves.toBeUndefined();
  });

  it('drops the foundation id when no CLA Group row matches the project id', async () => {
    const service = orgClaService({
      orgUid: ORG,
      claGroups: [group({ pairProjectSfid: 'a09410000182dOTHR' })],
    });

    await expect(sanitizeFoundationSfid(req, service, ORG, PROJECT, FOUNDATION)).resolves.toBeUndefined();
  });

  it('drops the foundation id when the matching row carries no foundation of its own', async () => {
    const service = orgClaService({
      orgUid: ORG,
      claGroups: [group({ foundationSfid: undefined })],
    });

    await expect(sanitizeFoundationSfid(req, service, ORG, PROJECT, FOUNDATION)).resolves.toBeUndefined();
  });

  it('drops the foundation id when the organization has no CLA Groups at all', async () => {
    const service = orgClaService({ orgUid: ORG, claGroups: [] });

    await expect(sanitizeFoundationSfid(req, service, ORG, PROJECT, FOUNDATION)).resolves.toBeUndefined();
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['malformed', 'not-an-sfid'],
  ])('returns undefined without an upstream call for a %s foundation id', async (_label, value) => {
    const service = orgClaService({ orgUid: ORG, claGroups: [group()] });

    await expect(sanitizeFoundationSfid(req, service, ORG, PROJECT, value)).resolves.toBeUndefined();
    expect(service.listClaGroups).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['malformed', 'not-an-sfid'],
  ])('returns undefined without an upstream call when the project id is %s', async (_label, value) => {
    const service = orgClaService({ orgUid: ORG, claGroups: [group()] });

    await expect(sanitizeFoundationSfid(req, service, ORG, value, FOUNDATION)).resolves.toBeUndefined();
    expect(service.listClaGroups).not.toHaveBeenCalled();
  });

  it('returns undefined without an upstream call when the foundation id equals the project id', async () => {
    const service = orgClaService({ orgUid: ORG, claGroups: [group()] });

    await expect(sanitizeFoundationSfid(req, service, ORG, PROJECT, PROJECT)).resolves.toBeUndefined();
    expect(service.listClaGroups).not.toHaveBeenCalled();
  });

  it('drops the foundation id rather than re-throwing when listClaGroups fails', async () => {
    const service = orgClaService(new Error('upstream exploded'));

    await expect(sanitizeFoundationSfid(req, service, ORG, PROJECT, FOUNDATION)).resolves.toBeUndefined();
  });

  // Without this log, an outage of the CLA Group list is indistinguishable from a client that sent
  // a foundation the row does not sit under — a foundation-only manager would see Add/Edit/Remove
  // hidden during an upstream incident with nothing in the logs to say why.
  it('logs fail-closed when listClaGroups fails so the degradation is traceable', async () => {
    const service = orgClaService(new Error('upstream exploded'));
    const { request, warn } = reqWithLogger();

    await expect(sanitizeFoundationSfid(request, service, ORG, PROJECT, FOUNDATION)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toMatch(/Foundation pair verification failed closed/i);
    expect(payload).toMatchObject({
      operation: 'check_org_cla_permission',
      status: 'warning',
      data: { org_uid: ORG, reason: 'upstream exploded' },
    });
  });
});
