// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The import graph reaches Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessCheckRequest } from '@lfx-one/shared/interfaces';

const { getAccessAwareOrgs, checkSingleAccessStrict, getEffectiveUsername, gatewayFetch } = vi.hoisted(() => ({
  getAccessAwareOrgs: vi.fn(),
  checkSingleAccessStrict: vi.fn(),
  getEffectiveUsername: vi.fn(),
  gatewayFetch: vi.fn(),
}));

// Only the upstreams are mocked: the read gate, the cla_admin check, the CLA gate and the scopes
// parser all run for real, so each cell pins the composed rule.
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('./gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('./api-gateway.helper', () => ({ getUserServiceBaseUrl: () => 'https://gw.test/user-service/v1' }));
vi.mock('../services/valkey.service', () => ({
  buildUserCacheKey: () => null,
  valkeyService: { withCache: (_key: unknown, _ttl: unknown, fetcher: () => Promise<unknown>) => fetcher() },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername(), isImpersonating: () => false }));
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { assertOrgLensClaRead } = await import('./org-lens-cla-access.helper');

const OWN = '0014100000Te2ovAAB';
const PARENT = '0014100000ParentAA';
const SIBLING = '0014100000SiblingA';
const PROJECT = 'a09410000182dD2AAI';

type UpstreamState = 'ok' | 'cla-admin-fails' | 'scopes-fail' | 'roster-fails' | 'auditor-check-fails';
type Outcome = 'org-grant' | 'auditor-entitlement' | 'cla-admin' | 'cla-manager-scope' | 403 | 503;

interface Persona {
  name: string;
  username?: string;
  /** Direct roster grant on OWN, when the caller has one. */
  roster?: 'direct-writer' | 'direct-auditor';
  /** What the authorizer answers for `b2b_org:OWN#auditor`. */
  auditor?: boolean;
  /** Organizations the authorizer grants `cla_admin` on. */
  claAdminOn?: string[];
  /** ACS scope roles held on OWN. */
  scopeRoles?: string[];
}

const DENIED: Record<UpstreamState, Outcome> = { ok: 403, 'cla-admin-fails': 403, 'scopes-fail': 503, 'roster-fails': 503, 'auditor-check-fails': 503 };

const MATRIX: [Persona, Record<UpstreamState, Outcome>][] = [
  [
    { name: 'org writer', roster: 'direct-writer', auditor: true },
    { ok: 'org-grant', 'cla-admin-fails': 'org-grant', 'scopes-fail': 'org-grant', 'roster-fails': 'auditor-entitlement', 'auditor-check-fails': 'org-grant' },
  ],
  [
    { name: 'org auditor', roster: 'direct-auditor', auditor: true },
    { ok: 'org-grant', 'cla-admin-fails': 'org-grant', 'scopes-fail': 'org-grant', 'roster-fails': 'auditor-entitlement', 'auditor-check-fails': 'org-grant' },
  ],
  [
    { name: 'auditor through the authorizer only (staff, cascade)', auditor: true },
    {
      ok: 'auditor-entitlement',
      'cla-admin-fails': 'auditor-entitlement',
      'scopes-fail': 'auditor-entitlement',
      'roster-fails': 'auditor-entitlement',
      'auditor-check-fails': 503,
    },
  ],
  [
    { name: 'auditor who is also a CLA manager of the same company', roster: 'direct-auditor', auditor: true, claAdminOn: [OWN], scopeRoles: ['cla-manager'] },
    { ok: 'org-grant', 'cla-admin-fails': 'org-grant', 'scopes-fail': 'org-grant', 'roster-fails': 'auditor-entitlement', 'auditor-check-fails': 'org-grant' },
  ],
  [
    { name: 'cla_admin only', claAdminOn: [OWN] },
    { ok: 'cla-admin', 'cla-admin-fails': 403, 'scopes-fail': 'cla-admin', 'roster-fails': 'cla-admin', 'auditor-check-fails': 'cla-admin' },
  ],
  [
    { name: 'cla-manager scope only (company with no b2b_org)', scopeRoles: ['cla-manager'] },
    {
      ok: 'cla-manager-scope',
      'cla-admin-fails': 'cla-manager-scope',
      'scopes-fail': 503,
      'roster-fails': 'cla-manager-scope',
      'auditor-check-fails': 'cla-manager-scope',
    },
  ],
  [
    { name: 'cla_admin and the cla-manager scope', claAdminOn: [OWN], scopeRoles: ['cla-manager'] },
    { ok: 'cla-admin', 'cla-admin-fails': 'cla-manager-scope', 'scopes-fail': 'cla-admin', 'roster-fails': 'cla-admin', 'auditor-check-fails': 'cla-admin' },
  ],
  [
    { name: 'username FGA cannot hold, with the cla-manager scope', username: 'first last', scopeRoles: ['cla-manager'] },
    {
      ok: 'cla-manager-scope',
      'cla-admin-fails': 'cla-manager-scope',
      'scopes-fail': 503,
      'roster-fails': 'cla-manager-scope',
      'auditor-check-fails': 'cla-manager-scope',
    },
  ],
  [{ name: 'cla_admin on the parent only', claAdminOn: [PARENT] }, DENIED],
  [{ name: 'cla_admin on a sibling only', claAdminOn: [SIBLING] }, DENIED],
  [{ name: 'CLA manager designee', scopeRoles: ['cla-manager-designee'] }, DENIED],
  [{ name: 'CLA signatory', scopeRoles: ['cla-signatory'] }, DENIED],
  [{ name: 'nobody', scopeRoles: [] }, DENIED],
];

const STATES: UpstreamState[] = ['ok', 'cla-admin-fails', 'scopes-fail', 'roster-fails', 'auditor-check-fails'];

function permissions(roles: string[]): Record<string, unknown> {
  const scopes = roles.map((role) => ({ Role: role, Type: 'project|organization', ID: [PROJECT, OWN], Level: 'member' }));
  return { Permissions: [{ Resource: 'cla_enabled_group', Actions: ['view_all'], Allowed: true, Scopes: scopes }] };
}

function arrange(persona: Persona, state: UpstreamState): void {
  getEffectiveUsername.mockReturnValue(persona.username ?? 'contributor');
  if (state === 'roster-fails') {
    getAccessAwareOrgs.mockRejectedValue(new Error('query-service down'));
  } else {
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(persona.roster ? [[OWN, { roleSource: persona.roster }]] : []), upstreamFailed: false });
  }
  checkSingleAccessStrict.mockImplementation(async (_req: Request, request: AccessCheckRequest) => {
    if (request.access === 'auditor') {
      if (state === 'auditor-check-fails') throw new Error('authorizer down');
      return request.id === OWN && persona.auditor === true;
    }
    if (request.access === 'cla_admin') {
      if (state === 'cla-admin-fails') throw new Error('relation cla_admin not found');
      return (persona.claAdminOn ?? []).includes(request.id);
    }
    return false;
  });
  if (state === 'scopes-fail') {
    gatewayFetch.mockRejectedValue(new Error('user-service down'));
  } else {
    gatewayFetch.mockResolvedValue(permissions(persona.scopeRoles ?? []));
  }
}

async function outcome(): Promise<Outcome> {
  const req = { path: `/api/orgs/${OWN}/lens/cla-groups`, params: { orgUid: OWN } } as unknown as Request;
  try {
    return await assertOrgLensClaRead(req, OWN, 'test');
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 403 || status === 503) return status;
    throw error;
  }
}

function claAdminChecks(): AccessCheckRequest[] {
  return checkSingleAccessStrict.mock.calls.map(([, request]) => request as AccessCheckRequest).filter((request) => request.access === 'cla_admin');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertOrgLensClaRead role matrix', () => {
  for (const [persona, expected] of MATRIX) {
    describe(persona.name, () => {
      it.each(STATES)('upstream state %s', async (state) => {
        arrange(persona, state);

        expect(await outcome()).toBe(expected[state]);
        // cla_admin is only ever asked for the organization in the request.
        expect(claAdminChecks().every((request) => request.id === OWN && request.resource === 'b2b_org')).toBe(true);
      });
    });
  }

  it('never asks cla_admin or user-service once the read gate admits', async () => {
    arrange(MATRIX[3][0], 'ok');

    expect(await outcome()).toBe('org-grant');
    expect(claAdminChecks()).toHaveLength(0);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('asks nothing beyond the read gate without an authenticated username', async () => {
    arrange({ name: 'anonymous', claAdminOn: [OWN], scopeRoles: ['cla-manager'] }, 'ok');
    getEffectiveUsername.mockReturnValue(undefined);

    expect(await outcome()).toBe(403);
    expect(claAdminChecks()).toHaveLength(0);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});

describe('with no cla_admin tuple anywhere, the outcome is the one the scopes alone gave', () => {
  const scopesOnly = (persona: Persona): Persona => ({ ...persona, claAdminOn: [] });

  for (const [persona] of MATRIX) {
    it.each(STATES)(`${persona.name}: state %s`, async (state) => {
      arrange(scopesOnly(persona), state);
      const withoutTuple = await outcome();

      vi.clearAllMocks();
      arrange(scopesOnly(persona), state === 'ok' ? 'cla-admin-fails' : state);
      expect(await outcome()).toBe(withoutTuple);
    });
  }
});
