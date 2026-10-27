// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { KeyContactDoc, KeyContactEmployee, ProjectMembershipIndexedDoc } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../e2e/fixtures/mock-data/synthetic-org.mock';

const { fetchAllQueryResourcesMock, proxyRequestMock } = vi.hoisted(() => ({
  fetchAllQueryResourcesMock: vi.fn(),
  proxyRequestMock: vi.fn(),
}));

vi.mock('../helpers/query-service.helper', () => ({ fetchAllQueryResources: fetchAllQueryResourcesMock }));
// The shared utils barrel pulls in @angular/forms, which cannot load in a plain Node runtime — deep-import
// the two helpers this service actually uses (docs/architecture/shared/package-architecture.md, GH-2381).
vi.mock('@lfx-one/shared/utils', async () => {
  const { isFilterSafeIdentifier } = await import('../../../../../packages/shared/src/utils/org-selector.utils');
  const { agreedUsername } = await import('../../../../../packages/shared/src/utils/identity.utils');
  return { isFilterSafeIdentifier, agreedUsername };
});
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: vi.fn().mockImplementation(() => ({ proxyRequest: proxyRequestMock })),
}));
vi.mock('./org-membership-resolver.service', () => ({ OrgMembershipResolverService: vi.fn().mockImplementation(() => ({ resolveContext: vi.fn() })) }));
vi.mock('./logger.service', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), startOperation: vi.fn().mockReturnValue(0) },
}));

const { logger } = await import('./logger.service');

const { OrgLensKeyContactsService } = await import('./org-lens-key-contacts.service');

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;
const req = {} as never;

function contact(over: Partial<KeyContactDoc> = {}): KeyContactDoc {
  return {
    uid: 'kc-1',
    project_membership_uid: 'm-active',
    role: 'Billing Contact',
    status: 'Active',
    first_name: 'Devon',
    last_name: 'Clarke',
    email: 'dclarke@lfx-partner.example',
    ...over,
  };
}

function membership(over: Partial<ProjectMembershipIndexedDoc> = {}): ProjectMembershipIndexedDoc {
  return { uid: 'm-active', project_slug: 'cncf', status: 'Active', ...over };
}

/**
 * The two fetches are issued together, so the stub answers on the query's own `type` rather than call
 * order — a reordering of the Promise.all would otherwise silently feed memberships to the contacts
 * branch and the scoping tests would pass for the wrong reason.
 */
function upstream(contacts: KeyContactDoc[], memberships: ProjectMembershipIndexedDoc[]): void {
  proxyRequestMock.mockImplementation(async (_req: unknown, _service: string, _path: string, _method: string, params: { type?: string }) => ({
    resources: params?.type === 'project_membership' ? memberships : contacts,
  }));
  fetchAllQueryResourcesMock.mockImplementation(async (_req: unknown, page: (token?: string) => Promise<{ resources?: unknown[] }>) => {
    const response = await page(undefined);
    return response.resources ?? [];
  });
}

/** Same discrimination, but one arm rejects — the membership index being down while contacts answer. */
function upstreamWithFailure(which: 'contacts' | 'memberships', contacts: KeyContactDoc[], memberships: ProjectMembershipIndexedDoc[]): void {
  proxyRequestMock.mockImplementation(async (_req: unknown, _service: string, _path: string, _method: string, params: { type?: string }) => {
    const isMembership = params?.type === 'project_membership';
    if (isMembership === (which === 'memberships')) throw new Error(`${which} upstream is down`);
    return { resources: isMembership ? memberships : contacts };
  });
  fetchAllQueryResourcesMock.mockImplementation(async (_req: unknown, page: (token?: string) => Promise<{ resources?: unknown[] }>) => {
    const response = await page(undefined);
    return response.resources ?? [];
  });
}

async function roles(contacts: KeyContactDoc[], memberships: ProjectMembershipIndexedDoc[]): Promise<string[]> {
  upstream(contacts, memberships);
  const employees: KeyContactEmployee[] = await new OrgLensKeyContactsService().getEmployees(req, ORG);
  return employees[0]?.roles ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  proxyRequestMock.mockResolvedValue({ resources: [] });
});

describe('OrgLensKeyContactsService.getEmployees — roles are scoped to active memberships', () => {
  it('keeps a role whose membership is active', async () => {
    expect(await roles([contact()], [membership()])).toEqual(['Billing Contact']);
  });

  it("keeps a role on a 'Purchased' membership, which is as live as 'Active'", async () => {
    expect(await roles([contact()], [membership({ status: 'Purchased' })])).toEqual(['Billing Contact']);
  });

  it('matches the membership status case-insensitively', async () => {
    expect(await roles([contact()], [membership({ status: 'active' })])).toEqual(['Billing Contact']);
  });

  it('drops a role whose membership has lapsed, even though the contact document is still Active', async () => {
    expect(await roles([contact()], [membership({ status: 'Expired' })])).toEqual([]);
  });

  it("drops a role whose contact is 'Pending', which the Key Contacts tab also omits", async () => {
    expect(await roles([contact({ status: 'Pending' })], [membership()])).toEqual([]);
  });

  it('treats an absent contact status as active, as the Key Contacts tab does', async () => {
    expect(await roles([contact({ status: undefined })], [membership()])).toEqual(['Billing Contact']);
  });

  it('matches the contact status case-insensitively', async () => {
    expect(await roles([contact({ status: 'ACTIVE' })], [membership()])).toEqual(['Billing Contact']);
  });

  it('keeps only the active half when one person holds an active and a pending role on live memberships', async () => {
    const held = await roles(
      [contact({ uid: 'kc-1', role: 'Billing Contact' }), contact({ uid: 'kc-2', role: 'Legal Contact', status: 'Pending' })],
      [membership()]
    );
    expect(held).toEqual(['Billing Contact']);
  });

  it('drops a role whose membership is absent from the org entirely', async () => {
    expect(await roles([contact({ project_membership_uid: 'm-unknown' })], [membership()])).toEqual([]);
  });

  it('drops a role it cannot attribute to any membership, rather than trusting it', async () => {
    expect(await roles([contact({ project_membership_uid: undefined, membership_uid: undefined })], [membership()])).toEqual([]);
  });

  it('reads the membership from the legacy `membership_uid` key when that is the one the index carried', async () => {
    expect(await roles([contact({ project_membership_uid: undefined, membership_uid: 'm-active' })], [membership()])).toEqual(['Billing Contact']);
  });

  it('keeps only the live half when one person holds roles on both a live and a lapsed membership', async () => {
    const held = await roles(
      [contact({ uid: 'kc-1', role: 'Billing Contact' }), contact({ uid: 'kc-2', role: 'Legal Contact', project_membership_uid: 'm-lapsed' })],
      [membership(), membership({ uid: 'm-lapsed', status: 'Expired' })]
    );
    expect(held).toEqual(['Billing Contact']);
  });

  it('dedupes a role the person holds on two separate live memberships', async () => {
    const held = await roles(
      [contact({ uid: 'kc-1' }), contact({ uid: 'kc-2', project_membership_uid: 'm-other' })],
      [membership(), membership({ uid: 'm-other', project_slug: 'lf', status: 'Active' })]
    );
    expect(held).toEqual(['Billing Contact']);
  });

  it('sorts the roles so the column renders the same order on every refetch', async () => {
    const held = await roles([contact({ uid: 'kc-1', role: 'Technical Contact' }), contact({ uid: 'kc-2', role: 'Authorized Signatory' })], [membership()]);
    expect(held).toEqual(['Authorized Signatory', 'Technical Contact']);
  });

  it('still lists the person for the pickers when every one of their roles was dropped', async () => {
    upstream([contact({ project_membership_uid: 'm-lapsed' })], [membership({ uid: 'm-lapsed', status: 'Expired' })]);

    const employees = await new OrgLensKeyContactsService().getEmployees(req, ORG);

    // Scoping removes the ROLE, not the person — the reassign pickers search the whole org.
    expect(employees).toHaveLength(1);
    expect(employees[0].email).toBe('dclarke@lfx-partner.example');
    expect(employees[0].roles).toEqual([]);
  });
});

describe('OrgLensKeyContactsService.getEmployees — a membership outage costs roles, not people', () => {
  it('still returns the employees when the membership read fails, with no roles', async () => {
    upstreamWithFailure('memberships', [contact()], [membership()]);

    const employees = await new OrgLensKeyContactsService().getEmployees(req, ORG);

    // The pickers search this list and replaceKeyContact reads it to choose PUT over create+delete, and
    // the directory folds this source in with allSettled — a rejection here would drop every
    // key-contact-only person out of the roster for the sake of a column.
    expect(employees).toHaveLength(1);
    expect(employees[0].email).toBe('dclarke@lfx-partner.example');
    expect(employees[0].roles).toEqual([]);
  });

  it('says so in the logs rather than failing quietly', async () => {
    upstreamWithFailure('memberships', [contact()], [membership()]);

    await new OrgLensKeyContactsService().getEmployees(req, ORG);

    expect(logger.warning).toHaveBeenCalledWith(req, 'get_org_key_contact_employees', expect.stringContaining('Membership read failed'), expect.anything());
  });

  it('still fails when the contacts themselves fail, since they are the read', async () => {
    upstreamWithFailure('contacts', [contact()], [membership()]);

    await expect(new OrgLensKeyContactsService().getEmployees(req, ORG)).rejects.toThrow('contacts upstream is down');
  });
});
