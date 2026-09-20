// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The service reaches the shared utils barrel for the approval-list sort, and that barrel pulls in
// Angular-dependent siblings. Without the compiler the suite fails to collect at all.
import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import type * as ClaIdentifierUtils from '../../../../../packages/shared/src/utils/cla-identifier.utils';
import type { MicroserviceError as MicroserviceErrorType } from '../errors';
import { customErrorSerializer } from '../helpers/error-serializer';
import type { EasyClaApprovalItem, EasyClaCompanyClaGroup, EasyClaCompanyClaGroupList, EasyClaCorporateSignature } from '../types/cla.types';

const { gatewayFetch, gatewayFetchBinary, isImpersonating, getUsernameFromAuth, loggerWarning, loggerInfo } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  gatewayFetchBinary: vi.fn(),
  isImpersonating: vi.fn(() => false),
  getUsernameFromAuth: vi.fn(async () => 'aporter' as string | null),
  loggerWarning: vi.fn(),
  loggerInfo: vi.fn(),
}));

// The shared utils barrel reaches Angular through unrelated siblings (form/meeting/vote), which the
// node test environment cannot compile. Only the real identifier helper is wanted here — pulled
// from its own module via `importActual` rather than restated, so the comparison under test is the
// one that ships. Same approach `rewards-subject.spec.ts` uses for the Salesforce pattern.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await vi.importActual<typeof ClaIdentifierUtils>('../../../../../packages/shared/src/utils/cla-identifier.utils');
  const approval = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/org-cla-approval.utils')>(
    '../../../../../packages/shared/src/utils/org-cla-approval.utils'
  );
  const managers = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/org-cla-manager.utils')>(
    '../../../../../packages/shared/src/utils/org-cla-manager.utils'
  );
  return {
    isSameClaGroup: actual.isSameClaGroup,
    canonicalClaGroupId: actual.canonicalClaGroupId,
    sortOrgClaApprovalEntries: approval.sortOrgClaApprovalEntries,
    classifyOrgClaManagerRefusal: managers.classifyOrgClaManagerRefusal,
  };
});

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../helpers/gateway-fetch-binary.helper', () => ({ gatewayFetchBinary }));
vi.mock('../helpers/cla-service-url.helper', () => ({ claServiceBaseUrl: () => 'https://gw.example.org/cla-service' }));
vi.mock('../utils/auth-helper', () => ({ isImpersonating, getUsernameFromAuth }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: loggerWarning, error: vi.fn(), debug: vi.fn(), info: loggerInfo },
}));

const { OrgClaService } = await import('./org-cla.service');
const { MicroserviceError } = await import('../errors');

const ORG_UID = '0014100000Te2ovAAB';

/** A complete upstream entry. Individual cases override only what they are about. */
function upstreamEntry(overrides: Partial<EasyClaCompanyClaGroup> = {}): EasyClaCompanyClaGroup {
  return {
    companyID: 'company-uuid-1',
    companySFID: ORG_UID,
    companyName: 'Vertex Robotics',
    signingEntityName: 'Vertex Robotics',
    claGroupID: 'cla-group-uuid-1',
    claGroupName: 'Nimbus Foundation CLA',
    foundationSFID: 'a09410000182dD2AAI',
    foundationName: 'Nimbus Foundation',
    projects: [
      { projectSFID: 'a09410000182dD3AAI', projectName: 'Cascade' },
      { projectSFID: 'a09410000182dD4AAI', projectName: 'Driftwood' },
    ],
    signed: true,
    signedOn: '2024-03-11T09:20:00Z',
    signatureID: 'signature-uuid-1',
    sanctioned: false,
    approvedContributorsCount: 412,
    claManagersCount: 2,
    claManagers: [
      { userID: 'user-uuid-1', lfUsername: 'aporter' },
      { userID: 'user-uuid-2', lfUsername: 'kmensah' },
    ],
    needsClaManager: false,
    autoCreateECLA: true,
    ...overrides,
  };
}

function upstreamList(...entries: EasyClaCompanyClaGroup[]): EasyClaCompanyClaGroupList {
  return { companySFID: ORG_UID, resultCount: entries.length, list: entries };
}

function req(overrides: Partial<Request> = {}): Request {
  return overrides as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  isImpersonating.mockReturnValue(false);
  getUsernameFromAuth.mockResolvedValue('aporter');
});

describe('OrgClaService.listClaGroups — the upstream call', () => {
  it('calls the organization CLA list with the grant-checked orgUid, unchanged', async () => {
    gatewayFetch.mockResolvedValue(upstreamList());

    await new OrgClaService().listClaGroups(req(), ORG_UID);

    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch).toHaveBeenCalledWith(
      expect.anything(),
      `https://gw.example.org/cla-service/v4/company/external/${ORG_UID}/cla-groups`,
      expect.objectContaining({ operation: 'org_cla_list_cla_groups', service: 'org_cla_service' })
    );
  });

  // The mapper keeps manager identities off the wire to the browser, but the fetch helper logs
  // raw payloads on a non-OK status or an unparseable body. Without redaction that second path
  // puts the same identities in application logs, defeating the boundary from the other side.
  it('redacts the response body so manager identities cannot reach the logs', async () => {
    gatewayFetch.mockResolvedValue(upstreamList());

    await new OrgClaService().listClaGroups(req(), ORG_UID);

    expect(gatewayFetch).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ redactResponseBody: true }));
  });

  it('sends no explicit bearer token when nobody is being impersonated', async () => {
    gatewayFetch.mockResolvedValue(upstreamList());

    await new OrgClaService().listClaGroups(req(), ORG_UID);

    expect(gatewayFetch).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ bearerToken: undefined }));
  });

  // The route authorizes the impersonated user, so the upstream call has to run as that user.
  // Sending the impersonator's token audits the request as the wrong identity, and fails
  // outright wherever only the target holds the organization scope.
  it("sends the target user's token while impersonating", async () => {
    isImpersonating.mockReturnValue(true);
    gatewayFetch.mockResolvedValue(upstreamList());

    await new OrgClaService().listClaGroups(req({ bearerToken: 'target-user-token' } as Partial<Request>), ORG_UID);

    expect(gatewayFetch).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ bearerToken: 'target-user-token' }));
  });

  it('ignores a company id the caller tried to supply in the query or body', async () => {
    gatewayFetch.mockResolvedValue(upstreamList());

    const result = await new OrgClaService().listClaGroups(
      req({ query: { companySFID: 'someone-elses-org' }, body: { orgUid: 'someone-elses-org' } } as Partial<Request>),
      ORG_UID
    );

    expect(gatewayFetch).toHaveBeenCalledWith(expect.anything(), expect.stringContaining(ORG_UID), expect.anything());
    expect(gatewayFetch).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('someone-elses-org'), expect.anything());
    expect(result.orgUid).toBe(ORG_UID);
  });

  it('issues exactly one upstream request however many agreements come back', async () => {
    gatewayFetch.mockResolvedValue(
      upstreamList(
        upstreamEntry({ signatureID: 's1' }),
        upstreamEntry({ signatureID: 's2' }),
        upstreamEntry({ signatureID: 's3' }),
        upstreamEntry({ signatureID: 's4' })
      )
    );

    const result = await new OrgClaService().listClaGroups(req(), ORG_UID);

    expect(result.claGroups).toHaveLength(4);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });
});

describe('OrgClaService.listClaGroups — empty versus failed', () => {
  it('treats an empty upstream list as "signed nothing", not an error', async () => {
    gatewayFetch.mockResolvedValue(upstreamList());

    await expect(new OrgClaService().listClaGroups(req(), ORG_UID)).resolves.toEqual({ orgUid: ORG_UID, claGroups: [] });
  });

  // A body the contract does not allow is a failure, and must reach the client as one. Reading
  // it as an empty list would state that the organization has signed nothing — the same false
  // claim the rejected-request case below refuses to make, arrived at by a different route.
  it('rejects a null upstream body rather than reading it as an empty list', async () => {
    gatewayFetch.mockResolvedValue(null);

    await expect(new OrgClaService().listClaGroups(req(), ORG_UID)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
  });

  it('rejects a response whose list is missing', async () => {
    gatewayFetch.mockResolvedValue({ companySFID: ORG_UID, resultCount: 0 });

    await expect(new OrgClaService().listClaGroups(req(), ORG_UID)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
  });

  it('rejects a response whose list is not an array', async () => {
    gatewayFetch.mockResolvedValue({ companySFID: ORG_UID, list: 'not-a-list' });

    await expect(new OrgClaService().listClaGroups(req(), ORG_UID)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
  });

  // The signature id is the row's identity and the list is keyed on it. Defaulting it to an empty
  // string would give every such row the same key, letting the view reuse one agreement's rendered
  // card for another — worse than declining to render the list at all.
  it('rejects a row that arrives without its signature id', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signatureID: undefined })));

    await expect(new OrgClaService().listClaGroups(req(), ORG_UID)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
  });

  it('lets an upstream failure propagate rather than degrading it to an empty list', async () => {
    // The distinction matters more here than on most endpoints: upstream returns the same
    // empty list for an unknown organization as for one that has signed nothing, so if a
    // failure also became an empty list there would be no signal left to tell a broken page
    // from a company that has signed no CLAs.
    gatewayFetch.mockRejectedValue(new Error('upstream exploded'));

    await expect(new OrgClaService().listClaGroups(req(), ORG_UID)).rejects.toThrow('upstream exploded');
  });
});

describe('OrgClaService.listClaGroups — what must not cross to the client', () => {
  it('carries no CLA manager identity or username anywhere in the response', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry()));

    const result = await new OrgClaService().listClaGroups(req(), ORG_UID);

    // Asserted over the whole serialized response rather than against named fields: a future
    // field carrying the same identities under another name would slip past a field-specific
    // check, and this is the one guarantee the feature cannot afford to lose quietly.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('aporter');
    expect(serialized).not.toContain('kmensah');
    expect(serialized).not.toContain('user-uuid-1');
    expect(serialized).not.toContain('user-uuid-2');
    expect(serialized).not.toContain('claManagers"');
  });

  it('keeps the manager count while dropping the managers', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ claManagersCount: 2 })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.claManagersCount).toBe(2);
    expect(row).not.toHaveProperty('claManagers');
  });

  it('does not carry the auto-ECLA flag, which belongs to a later surface', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ autoCreateECLA: true })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row).not.toHaveProperty('autoCreateECLA');
  });
});

describe('OrgClaService.listClaGroups — the approval-criteria count', () => {
  it('carries the count upstream supplies', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ approvalCriteriaCount: 7 })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.approvalCriteriaCount).toBe(7);
  });

  // Upstream declares the field `x-omitempty: false`, so a deployment carrying it sends 0 for an
  // agreement with no rules. That is a real answer and has to survive the mapper.
  it('carries a supplied zero rather than dropping it', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ approvalCriteriaCount: 0 })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.approvalCriteriaCount).toBe(0);
  });

  // The distinction the previous test protects only means something if the other side holds:
  // a deployment predating the producer change sends nothing, and nothing must not become 0.
  // One says "this agreement approves nobody"; the other says "this deployment cannot tell you".
  it('leaves the count absent when upstream omits it, rather than defaulting to zero', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ approvalCriteriaCount: undefined })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.approvalCriteriaCount).toBeUndefined();
    expect('approvalCriteriaCount' in row).toBe(false);
  });

  it('does not fill the approval-criteria count from the employee-acknowledgement count', async () => {
    // These are different quantities: approval criteria are the rules deciding who may be
    // covered, acknowledgements are the people covered. Asserting "not zero" alone would
    // still pass if the acknowledgement count were substituted here, which is the specific
    // mistake worth pinning.
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ approvedContributorsCount: 412, approvalCriteriaCount: 3 })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.approvalCriteriaCount).toBe(3);
    expect(JSON.stringify(row)).not.toContain('412');
  });
});

describe('OrgClaService.listClaGroups — status', () => {
  it('maps a signed, unsanctioned agreement to signed', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: true, sanctioned: false })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.status).toBe('signed');
  });

  // Upstream's query filters to signed signatures, so this payload is not one the live list
  // produces — it pins the mapper's rule, not a reachable list state. Worth pinning anyway: the
  // rule is what makes the same mapper safe for a producer that relaxes the filter, and calling
  // an unsigned agreement signed would state that an organization has signed something it has not.
  it('maps an unsigned agreement to not-started rather than to signed', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: false, sanctioned: false })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.status).toBe('not-started');
  });

  // Absence understates rather than overstates: upstream always sends the flag, so a missing
  // one means a producer this consumer does not recognise, and claiming "signed" on its behalf
  // is the direction that does harm.
  it('treats a missing signed flag as not-started', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: undefined, sanctioned: false })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.status).toBe('not-started');
  });

  // Upstream backfills its date field with the signature's creation time when there is no signing
  // timestamp, so an unsigned row arrives carrying a real date that is not a signing date. Passing
  // it on would give the detail view something to present as a signature date for an agreement
  // that has none — the status fix above, undone one field over.
  it('withholds the signed date on an unsigned agreement', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: false, signedOn: '2024-03-11T09:20:00Z' })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.signedOn).toBeUndefined();
    expect(row.status).toBe('not-started');
  });

  it('carries the signed date on a signed agreement', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: true, signedOn: '2024-03-11T09:20:00Z' })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.signedOn).toBe('2024-03-11T09:20:00Z');
  });

  it('carries the signer name on a signed agreement', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: true, signedBy: 'Alex Signer' })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.signedBy).toBe('Alex Signer');
  });

  it('withholds the signer name on an unsigned agreement', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: false, signedBy: 'Alex Signer' })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.signedBy).toBeUndefined();
  });

  // Upstream omits the field for a blank signatory name, and a deployment predating it omits it
  // too. Both mean the signer is unknown, which the row states by carrying nothing.
  it('omits the signer name when upstream sends none', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: true, signedBy: undefined })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.signedBy).toBeUndefined();
    expect(row.signedOn).toBe('2024-03-11T09:20:00Z');
  });

  it('lets sanctioned win over an unsigned agreement too', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: false, sanctioned: true })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.status).toBe('sanctioned');
  });

  it('maps a sanctioned signing entity to sanctioned', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ sanctioned: true })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.status).toBe('sanctioned');
  });

  it('lets sanctioned win when the agreement is both signed and sanctioned', async () => {
    // The case the two independent upstream booleans make reachable and the single status
    // slot cannot represent. Showing this as an ordinary signed agreement is the damaging
    // direction, so the collapse goes the other way.
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ signed: true, sanctioned: true })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.status).toBe('sanctioned');
  });

  it('treats a missing sanctions flag as unsanctioned', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ sanctioned: undefined })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.status).toBe('signed');
  });
});

describe('OrgClaService.listClaGroups — needs a CLA manager', () => {
  it('takes the upstream flag verbatim', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ needsClaManager: true, claManagersCount: 0 })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.needsClaManager).toBe(true);
  });

  it('does not re-derive the flag from the manager count when upstream disagrees', async () => {
    // Zero managers with the flag unset should surface as upstream reported it. Recomputing
    // it here would create a second definition of the same condition, which is exactly how
    // the two drift apart later.
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ needsClaManager: false, claManagersCount: 0 })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.needsClaManager).toBe(false);
    expect(row.claManagersCount).toBe(0);
  });

  it('treats a missing flag as not needing a manager', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ needsClaManager: undefined })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.needsClaManager).toBe(false);
  });
});

describe('OrgClaService.listClaGroups — identity and naming', () => {
  it('keys the row on the signature, so two signing entities on one CLA group stay distinct', async () => {
    gatewayFetch.mockResolvedValue(
      upstreamList(
        upstreamEntry({ signatureID: 'signature-a', signingEntityName: 'Vertex Robotics GmbH' }),
        upstreamEntry({ signatureID: 'signature-b', signingEntityName: 'Vertex Robotics KK' })
      )
    );

    const { claGroups } = await new OrgClaService().listClaGroups(req(), ORG_UID);

    expect(claGroups.map((row) => row.id)).toEqual(['signature-a', 'signature-b']);
    expect(claGroups[0].claGroupId).toBe(claGroups[1].claGroupId);
  });

  it('falls back to the CLA group id when the name is missing, so the card is still identifiable', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ claGroupName: undefined, claGroupID: 'cla-group-uuid-9' })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.claGroupName).toBe('cla-group-uuid-9');
  });

  it('omits the signing entity when it matches the organization name', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ companyName: 'Vertex Robotics', signingEntityName: 'Vertex Robotics' })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.signingEntityName).toBeUndefined();
  });

  it('keeps the signing entity when it differs from the organization name', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ companyName: 'Vertex Robotics', signingEntityName: 'Vertex Robotics GmbH' })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.signingEntityName).toBe('Vertex Robotics GmbH');
  });

  it('compares the signing entity after trimming, so stray whitespace does not produce a subline', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ companyName: 'Vertex Robotics', signingEntityName: '  Vertex Robotics  ' })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.signingEntityName).toBeUndefined();
  });
});

describe('OrgClaService.listClaGroups — coverage', () => {
  it('carries covered projects in the upstream order', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry()));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.projects.map((project) => project.projectName)).toEqual(['Cascade', 'Driftwood']);
    expect(row.projects[0].projectSfid).toBe('a09410000182dD3AAI');
  });

  it('drops a project with no name rather than counting it', async () => {
    // An unnamed project cannot be rendered or searched, and counting it would overstate the
    // "Covers N projects" line against what the card actually shows.
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ projects: [{ projectSFID: 'a1', projectName: 'Cascade' }, { projectSFID: 'a2' }] })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.projects).toHaveLength(1);
    expect(row.projects[0].projectName).toBe('Cascade');
  });

  it('yields an empty coverage list when upstream sends none', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry({ projects: undefined })));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.projects).toEqual([]);
  });
});

describe('OrgClaService.listClaGroups — order and detail hand-off', () => {
  it('preserves the upstream order rather than re-sorting', async () => {
    gatewayFetch.mockResolvedValue(
      upstreamList(
        upstreamEntry({ signatureID: 's1', claGroupName: 'Zephyr Foundation CLA' }),
        upstreamEntry({ signatureID: 's2', claGroupName: 'Alder Foundation CLA' })
      )
    );

    const { claGroups } = await new OrgClaService().listClaGroups(req(), ORG_UID);

    expect(claGroups.map((row) => row.claGroupName)).toEqual(['Zephyr Foundation CLA', 'Alder Foundation CLA']);
  });

  it('carries the signed date and foundation ids the agreement detail view reads off the row', async () => {
    gatewayFetch.mockResolvedValue(upstreamList(upstreamEntry()));

    const [row] = (await new OrgClaService().listClaGroups(req(), ORG_UID)).claGroups;

    expect(row.signedOn).toBe('2024-03-11T09:20:00Z');
    expect(row.foundationSfid).toBe('a09410000182dD2AAI');
    expect(row.foundationName).toBe('Nimbus Foundation');
  });
});

describe('OrgClaService.getPdfUrl', () => {
  // The document read is preceded by the organization's own list, which is what binds the
  // signature to the caller's organization. Both upstream calls are staged, in that order.
  function stageDocument(document: unknown, entries: EasyClaCompanyClaGroup[] = [upstreamEntry()]): void {
    gatewayFetch.mockResolvedValueOnce(upstreamList(...entries)).mockResolvedValueOnce(document);
  }

  function stageDocumentFailure(error: unknown, entries: EasyClaCompanyClaGroup[] = [upstreamEntry()]): void {
    gatewayFetch.mockResolvedValueOnce(upstreamList(...entries)).mockRejectedValueOnce(error);
  }

  it('maps signed_cla_url onto the shared download shape', async () => {
    stageDocument({ signature_id: 'signature-uuid-1', signed_cla_url: 'https://s3.example.org/ccla.pdf' });

    const pdf = await new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-uuid-1');

    expect(pdf).toEqual({ url: 'https://s3.example.org/ccla.pdf' });
    expect(gatewayFetch).toHaveBeenCalledWith(
      expect.anything(),
      'https://gw.example.org/cla-service/v4/signatures/signature-uuid-1/signed-document',
      expect.objectContaining({ operation: 'org_cla_get_pdf_url', service: 'org_cla_service' })
    );
  });

  it('also accepts the camelCase field names a generated client may emit', async () => {
    stageDocument({ signatureID: 'signature-uuid-1', signedClaUrl: 'https://s3.example.org/ccla.pdf' });

    expect(await new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-uuid-1')).toEqual({ url: 'https://s3.example.org/ccla.pdf' });
  });

  it('returns null on a 404', async () => {
    const { MicroserviceError } = await import('../errors');
    stageDocumentFailure(new MicroserviceError('not found', 404, 'NOT_FOUND', { service: 'cla_service' }));

    expect(await new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-uuid-1')).toBeNull();
  });

  it('returns null when upstream omits the url', async () => {
    stageDocument({ signature_id: 'signature-uuid-1' });

    expect(await new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-uuid-1')).toBeNull();
  });

  it('answers absent for an unsigned agreement without asking upstream for a document', async () => {
    // Only the list is staged: reaching the document endpoint at all is the failure this guards.
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-uuid-1', signed: false, sanctioned: true })));

    expect(await new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-uuid-1')).toBeNull();

    // Upstream presigns the expected key without checking that a document was ever written
    // there, so asking would hand back a URL to nothing.
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('propagates a 403 rather than turning it into a missing document', async () => {
    const { MicroserviceError } = await import('../errors');
    stageDocumentFailure(new MicroserviceError('forbidden', 403, 'FORBIDDEN', { service: 'cla_service' }));

    await expect(new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-uuid-1')).rejects.toMatchObject({ statusCode: 403 });
  });

  // The 403 above is routine here, not exceptional: the producer authorizes the document by
  // project scope, which an organization-only viewer can lack for an agreement they can see
  // listed. Its body names the authenticated user, and the fetch helper logs the raw payload on a
  // non-OK status — so without redaction the ordinary case writes an identity into the logs.
  it('redacts the response body so a refusal cannot log who was refused', async () => {
    stageDocument({ signed_cla_url: 'https://s3.example.org/ccla.pdf' });

    await new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-uuid-1');

    expect(gatewayFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('/v4/signatures/signature-uuid-1/signed-document'),
      expect.objectContaining({ redactResponseBody: true })
    );
  });

  it('authorizes the document read with the target token during impersonation', async () => {
    isImpersonating.mockReturnValue(true);
    stageDocument({ signed_cla_url: 'https://s3.example.org/ccla.pdf' });

    await new OrgClaService().getPdfUrl(req({ bearerToken: 'target-token' }), ORG_UID, 'signature-uuid-1');

    expect(gatewayFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('/v4/signatures/signature-uuid-1/signed-document'),
      expect.objectContaining({ bearerToken: 'target-token' })
    );
  });
});

// The org grant proves which organization the caller may view as, not which signatures belong to
// it. Without the list lookup the signature id alone selects the document, so any id a caller can
// name is readable under their own organization's path.
describe('OrgClaService.getPdfUrl — the organization scope gate', () => {
  it('answers a signature that is not on the organization list as absent', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-this-org-signed' })));

    expect(await new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-another-org-signed')).toBeNull();
  });

  it('never reaches the document endpoint for a signature the organization does not hold', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-this-org-signed' })));

    await new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-another-org-signed');

    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/signed-document'), expect.anything());
  });

  it('resolves the list against the caller-scoped orgUid, not anything the request carried', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ signed_cla_url: 'https://s3.example.org/ccla.pdf' });

    await new OrgClaService().getPdfUrl(req(), ORG_UID, 'signature-uuid-1');

    expect(gatewayFetch).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      `https://gw.example.org/cla-service/v4/company/external/${ORG_UID}/cla-groups`,
      expect.objectContaining({ operation: 'org_cla_list_cla_groups' })
    );
  });
});

// ---------------------------------------------------------------------------
// Corporate signing hand-off (#1983)
// ---------------------------------------------------------------------------

const CLA_GROUP_ID = '7f3a1c22-9d51-4a8e-b0c6-2e4f81d9a733';
const PROJECT_SFID = 'a09410000182dD3AAI';

/** A request the CLA service would accept. Cases override only what they are about. */
function signRequest(overrides: Record<string, unknown> = {}) {
  return { projectSfid: PROJECT_SFID, claGroupId: CLA_GROUP_ID, authorityAcked: true, embargoAcked: true, ...overrides } as any;
}

function mailedRequest() {
  return signRequest({ sendAsEmail: true, authorityName: 'Alex Contributor', authorityEmail: 'contributor@example.org' });
}

/** A request carrying the Host the return address is derived from. */
function signReq(): Request {
  return { protocol: 'https', get: (header: string) => (header === 'host' ? 'app.lfx.dev' : undefined) } as unknown as Request;
}

describe('OrgClaService.getSignOptions', () => {
  it('carries the project Salesforce id upstream sent, which is what the corporate request is keyed on', async () => {
    gatewayFetch.mockResolvedValueOnce({
      searchTerm: 'nimbus',
      resultCount: 1,
      results: [{ claGroupID: CLA_GROUP_ID, claGroupName: 'Nimbus Foundation CLA', projectName: 'Cascade', projectSFID: PROJECT_SFID, cclaEnabled: true }],
    });

    const envelope = await new OrgClaService().getSignOptions(req(), 'nimbus');

    expect(envelope.results[0]).toMatchObject({ claGroupId: CLA_GROUP_ID, projectSfid: PROJECT_SFID, cclaEnabled: true });
  });

  // Upstream leaves the id unset for a CLA group spanning several projects with no
  // foundation-level row. Defaulting it to an empty string would make the row look signable and
  // produce a request that cannot succeed; the picker needs to see the absence.
  it('omits the project id entirely when upstream resolved none, rather than defaulting it', async () => {
    gatewayFetch.mockResolvedValueOnce({
      searchTerm: 'nimbus',
      resultCount: 1,
      results: [{ claGroupID: CLA_GROUP_ID, claGroupName: 'Nimbus Foundation CLA', cclaEnabled: true }],
    });

    const envelope = await new OrgClaService().getSignOptions(req(), 'nimbus');

    expect(envelope.results[0]).not.toHaveProperty('projectSfid');
  });

  it('treats a blank project id as no project id', async () => {
    gatewayFetch.mockResolvedValueOnce({
      searchTerm: 'nimbus',
      resultCount: 1,
      results: [{ claGroupID: CLA_GROUP_ID, projectSFID: '   ', cclaEnabled: true }],
    });

    expect(await new OrgClaService().getSignOptions(req(), 'nimbus')).toMatchObject({ results: [expect.not.objectContaining({ projectSfid: '   ' })] });
  });

  it('preserves the envelope fields the picker reads', async () => {
    gatewayFetch.mockResolvedValueOnce({ searchTerm: 'nimbus', resultCount: 40, truncated: true, results: [] });

    expect(await new OrgClaService().getSignOptions(req(), 'nimbus')).toMatchObject({ searchTerm: 'nimbus', resultCount: 40, truncated: true });
  });
});

describe('OrgClaService.requestCorporateSignature', () => {
  const upstreamOk = {
    signature_id: 'signature-uuid-1',
    sign_url: 'https://docusign.example.org/session/1',
    cla_group_id: CLA_GROUP_ID,
    project_sfid: PROJECT_SFID,
    company_id: 'company-uuid-1',
    company_sfid: ORG_UID,
  };

  // snake_case on this upstream, unlike the Me-lens prepare-sign next door, which is camelCase in
  // both directions. Getting this wrong fails silently: go-swagger ignores unknown keys, so a
  // camelCase body would arrive as a request with no project and no attestations.
  it('sends the body in snake_case, with the organization from the grant-checked path', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest());

    expect(gatewayFetch).toHaveBeenCalledWith(
      expect.anything(),
      'https://gw.example.org/cla-service/v4/self-serve/request-corporate-signature',
      expect.objectContaining({
        method: 'POST',
        // The whole body. A subset matcher would not notice a required field going missing, and
        // would not notice a designee field being added either.
        body: {
          project_sfid: PROJECT_SFID,
          company_sfid: ORG_UID,
          return_url: `https://app.lfx.dev/org/easycla/${CLA_GROUP_ID}?org=${ORG_UID}&signed=1`,
          authority_acked: true,
          embargo_acked: true,
        },
      })
    );
  });

  // The counterpart to the controller's gate, one layer down: even reached directly, this method
  // relays what it was given. A literal here would mean the controller's check was the only thing
  // standing between a withdrawn confirmation and a signed agreement.
  it('relays a withdrawn confirmation as withdrawn rather than substituting true', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest({ embargoAcked: false }));

    expect(gatewayFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ body: expect.objectContaining({ authority_acked: true, embargo_acked: false }) })
    );
  });

  it('derives the return address server-side, pointing at the Organization Lens rather than the profile CLAs', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest());

    expect(gatewayFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        body: expect.objectContaining({ return_url: `https://app.lfx.dev/org/easycla/${CLA_GROUP_ID}?org=${ORG_UID}&signed=1` }),
      })
    );
  });

  // The whole point of #2352: the signature does not exist yet, but the CLA Group does, and since
  // #2364 that is what the detail page is addressed by — so the return can name the agreement
  // rather than the list that would then have to hop to it.
  it('returns the signatory to the CLA Group they are signing, not to the list', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest());

    const body = gatewayFetch.mock.calls[0][2].body as { return_url: string };

    expect(new URL(body.return_url).pathname).toBe(`/org/easycla/${CLA_GROUP_ID}`);
  });

  // The row is not on the organization's list the instant they arrive. Without the flag the page
  // reads a group with no signed agreement and settles straight onto the cannot-preview state.
  it('flags the return so the page waits for the signature rather than settling without it', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest());

    const body = gatewayFetch.mock.calls[0][2].body as { return_url: string };

    expect(new URL(body.return_url).searchParams.get('signed')).toBe('1');
  });

  // Without this the signatory returns through a cross-site navigation carrying only a
  // `SameSite=Lax` cookie, and when it does not come back the page selects the first organization
  // in their list — so signing for one company lands them looking at another.
  it('names the organization on the return address rather than leaving the page to guess it', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest());

    const body = gatewayFetch.mock.calls[0][2].body as { return_url: string };
    const returned = new URL(body.return_url);

    expect(returned.pathname).toBe(`/org/easycla/${CLA_GROUP_ID}`);
    // The organization the grant check cleared and the request was made for, not a client value.
    expect(returned.searchParams.get('org')).toBe(ORG_UID);
  });

  // Self-sign still omits the mail fields. `send_as_email` in particular changes what the response means.
  it('sends none of the designee or send-by-email fields', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest());

    const body = gatewayFetch.mock.calls[0][2].body;
    expect(body).not.toHaveProperty('send_as_email');
    expect(body).not.toHaveProperty('authority_name');
    expect(body).not.toHaveProperty('authority_email');
    expect(body).not.toHaveProperty('signing_entity_name');
  });

  it('sends the named signatory on send-by-email and omits the two attestations', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: '' });

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, mailedRequest());

    const body = gatewayFetch.mock.calls[0][2].body as Record<string, unknown>;
    expect(body).toMatchObject({
      send_as_email: true,
      authority_name: 'Alex Contributor',
      authority_email: 'contributor@example.org',
    });
    expect(body).not.toHaveProperty('authority_acked');
    expect(body).not.toHaveProperty('embargo_acked');
    expect(body).not.toHaveProperty('return_url');
    expect(JSON.stringify(loggerInfo.mock.calls)).not.toContain('contributor@example.org');
    expect(JSON.stringify(loggerInfo.mock.calls)).not.toContain('Alex Contributor');
  });

  it('treats an empty signing address as success on send-by-email when the signature and CLA Group are present', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: '' });

    expect(await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, mailedRequest())).toEqual({
      signUrl: '',
      signatureId: 'signature-uuid-1',
    });
  });

  it('refuses send-by-email when the response still carries a signing address', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, mailedRequest())).rejects.toMatchObject({
      statusCode: 502,
      code: 'CLA_SIGN_MAIL_UNEXPECTED_URL',
    });
  });

  it('refuses send-by-email when the response carries no signature id', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: '', signature_id: '' });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, mailedRequest())).rejects.toThrow(/no usable corporate signing session/);
  });

  it('refuses send-by-email when upstream returns no body', async () => {
    gatewayFetch.mockResolvedValueOnce(null);

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, mailedRequest())).rejects.toThrow(/no usable corporate signing session/);
  });

  it('refuses send-by-email when the response carries no CLA Group', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: '', cla_group_id: '' });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, mailedRequest())).rejects.toThrow(/attributed to no CLA Group/);
  });

  it('refuses send-by-email when the CLA Group does not match', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: '', cla_group_id: 'a-different-cla-group-uuid' });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, mailedRequest())).rejects.toThrow(/different CLA Group/);
  });

  it('maps the upstream response onto the shape the client consumes', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    // The address and the signature it belongs to, and nothing else. Upstream also returns the CLA
    // group, project and company identifiers, and none of those has a client consumer. The signature
    // id does: the return address is an input to this request and so cannot name the signature, which
    // leaves the client as the only place the two are held together.
    expect(await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).toEqual({
      signUrl: 'https://docusign.example.org/session/1',
      signatureId: 'signature-uuid-1',
    });
  });

  // An empty signing address is how upstream reports that it emailed a named signatory instead —
  // a shape self-sign never asks for. Returning it as success would navigate the signatory to
  // this application's own root and read as a completed hand-off.
  it.each([[''], ['   '], [undefined]])('fails rather than succeeding when the signing address is %p', async (signUrl) => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: signUrl });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).rejects.toThrow(/no usable corporate signing session/);
  });

  // The client assigns this value to `document.location.href`, so a scheme that executes rather
  // than navigates would run in this origin at the moment the signatory expects to be sent away.
  // The whitespace and mixed-case entries are the ones a written-out comparison misses: the
  // browser trims and lowercases the scheme before acting on it, so both of those execute.
  it.each([
    ['javascript:alert(document.cookie)'],
    ['  javascript:alert(1)'],
    ['\tjavascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['http://docusign.example.org/session/1'],
    ['/session/1'],
    ['not a url at all'],
  ])('refuses a signing address of %p rather than handing it to the browser', async (signUrl) => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: signUrl });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).rejects.toThrow(/unusable corporate signing address/);
  });

  // The address is a capability — it opens a named person's agreement — and a hostile one should
  // not be written anywhere either. Only its scheme is recorded.
  it('keeps the refused address out of the logs', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: 'javascript:alert(document.cookie)' });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).rejects.toThrow();

    const logged = JSON.stringify(loggerWarning.mock.calls);
    expect(logged).not.toContain('alert(document.cookie)');
    expect(logged).toContain('javascript');
  });

  // A refused address with no scheme at all is the one most likely to be an opaque token, so it is
  // also the one that must not be echoed into the log while reaching for a scheme that isn't there.
  it('records no fragment of a refused address that has no scheme', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: 'Zm9yZ2VkLXNpZ25pbmctY2FwYWJpbGl0eS10b2tlbg' });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).rejects.toThrow();

    expect(JSON.stringify(loggerWarning.mock.calls)).not.toContain('Zm9yZ2Vk');
  });

  it('fails when upstream returned no signature identifier', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, signature_id: '' });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).rejects.toThrow(/no usable corporate signing session/);
  });

  // The agreement is requested by project; the upstream input has no CLA Group field, so the group
  // the signatory chose cannot be bound to the request and the echoed one is the only way to tell
  // whether the session that came back is for the agreement they picked. Handing over a mismatched
  // session would have them sign the wrong corporate agreement with nothing recording it.
  it('refuses a session opened for a different CLA Group than the one chosen', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, cla_group_id: 'a-different-cla-group-uuid' });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).rejects.toThrow(/different CLA Group/);
  });

  // The request boundary accepts hyphenated and unhyphenated spellings in either case; the producer
  // answers in its own. Comparing raw refuses a perfectly valid session after the envelope exists,
  // which is worse than not checking at all — so the accepted spellings are pinned here.
  it.each([
    ['unhyphenated request', CLA_GROUP_ID.replaceAll('-', '')],
    ['upper-case request', CLA_GROUP_ID.toUpperCase()],
  ])('accepts the canonical echo against an %s', async (_label, claGroupId) => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, cla_group_id: CLA_GROUP_ID });

    expect(await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest({ claGroupId }))).toEqual({
      signUrl: 'https://docusign.example.org/session/1',
      signatureId: 'signature-uuid-1',
    });
  });

  it('does not hand back the signing address when the CLA Group does not match', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, cla_group_id: 'a-different-cla-group-uuid' });

    const outcome = await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest()).catch((error: unknown) => error);

    expect(JSON.stringify(outcome)).not.toContain('docusign.example.org');
  });

  // The echo is the whole check. An answer that carries no CLA Group cannot be shown to be the
  // agreement the signatory chose, which from here is indistinguishable from one that is not — so
  // it is refused on the same terms as a mismatch rather than accepted for lacking the evidence.
  it.each([[''], ['   '], [undefined]])('refuses a session attributed to no CLA Group, given %p', async (claGroupId) => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, cla_group_id: claGroupId });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).rejects.toThrow(/attributed to no CLA Group/);
  });

  it('does not hand back the signing address when the session is attributed to no CLA Group', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, cla_group_id: '' });

    const outcome = await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest()).catch((error: unknown) => error);

    expect(JSON.stringify(outcome)).not.toContain('docusign.example.org');
  });

  // The trade-compliance refusal is a 403 whose body is a sentence written for the signatory,
  // naming the reason and the support route. Showing "403 Forbidden" instead discards it.
  it("re-labels a 403 with the CLA service's own words", async () => {
    const refusal = new MicroserviceError('Forbidden', 403, 'UPSTREAM_ERROR', {
      service: 'org_cla_service',
      errorBody: JSON.stringify({
        message: 'We are sorry, but this organization requires additional trade compliance review, so the CLA cannot be completed at this time.',
      }),
    });
    gatewayFetch.mockRejectedValueOnce(refusal);

    const thrown = await new OrgClaService()
      .requestCorporateSignature(signReq(), ORG_UID, signRequest())
      .then(() => null)
      .catch((error: unknown) => error);

    // `clientMessage`, not `message`: the sentence is what the signatory reads and `toResponse`
    // serves it, while `message` — the one the error handler formats into its log line — stays
    // generic. Asserting `rejects.toThrow(/…/)` here would match on `message` and so would pass
    // for the version of this code that logged the refusal.
    expect((thrown as MicroserviceErrorType).clientMessage).toMatch(/trade compliance review/);
    expect((thrown as MicroserviceErrorType).toResponse()['error']).toMatch(/trade compliance review/);
    expect((thrown as MicroserviceErrorType).message).not.toMatch(/trade compliance review/);
  });

  /**
   * A refusal from this endpoint names the caller's LF username when it is about scope, and the
   * organization's trade-compliance standing when it is about sanctions. Neither belongs in an
   * application log.
   *
   * Full redaction is not available here: `gatewayFetch` discards the body under that option, and
   * the body is the only place the refusal sentence exists — the relay above would go with it. So
   * the body is kept out of the log at the fetch, and dropped from the error afterwards, once its
   * message has been taken out. Both halves are needed, and the second is the easier one to miss:
   * without it the error reaches the API error handler still carrying the body, and that handler
   * logs `getLogContext()`, which includes it.
   */
  it('keeps the upstream refusal body out of the logs', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest());

    expect(gatewayFetch).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ redactResponseBodyFromLogs: true }));
  });

  it('relays the refusal sentence without carrying the body that held it', async () => {
    const refusal = 'This organization requires additional trade compliance review. Contact support to review the determination.';
    gatewayFetch.mockRejectedValueOnce(
      new MicroserviceError('Forbidden', 403, 'UPSTREAM_ERROR', {
        service: 'org_cla_service',
        // The shape upstream actually sends on a sanctions refusal: the sentence, alongside fields
        // that identify the organization's standing and must not survive into a log line.
        errorBody: JSON.stringify({ message: refusal, company_sfid: ORG_UID, sanction_status: 'pending_review' }),
      })
    );

    const thrown = await new OrgClaService()
      .requestCorporateSignature(signReq(), ORG_UID, signRequest())
      .then(() => null)
      .catch((error: unknown) => error);

    expect((thrown as MicroserviceErrorType).clientMessage).toBe(refusal);
    expect((thrown as MicroserviceErrorType).errorBody).toBeUndefined();
    // The API error handler spreads this into its log line, so it is the thing that must be clean.
    expect(JSON.stringify((thrown as MicroserviceErrorType).getLogContext())).not.toContain('sanction_status');
    // And the sentence itself, which the log line carries separately as `API error: ${message}`.
    expect((thrown as MicroserviceErrorType).message).not.toContain(refusal);
    // The whole error as any key-enumerating serializer would see it — `customErrorSerializer`
    // copies every own string key onto the log payload, so a client message held under one would
    // be written straight back into the line the two assertions above just cleaned.
    expect(JSON.stringify({ ...(thrown as object), message: (thrown as Error).message })).not.toContain(refusal);
  });

  // Nothing about the body-dropping is 403-specific: a 5xx body from this endpoint is no more
  // loggable, and it is not relayed either, so it has no reason to survive the throw.
  it('carries no upstream body on a failure it did not relay', async () => {
    gatewayFetch.mockRejectedValueOnce(
      new MicroserviceError('Failed to request the corporate CLA signature', 500, 'UPSTREAM_ERROR', {
        service: 'org_cla_service',
        errorBody: JSON.stringify({ message: 'panic in signature repository', lf_username: 'someone' }),
      })
    );

    const thrown = await new OrgClaService()
      .requestCorporateSignature(signReq(), ORG_UID, signRequest())
      .then(() => null)
      .catch((error: unknown) => error);

    expect((thrown as MicroserviceErrorType).errorBody).toBeUndefined();
    expect(JSON.stringify((thrown as MicroserviceErrorType).getLogContext())).not.toContain('lf_username');
  });

  // Scoped to 403 for the reason the helper documents: a 500's prose is about upstream internals,
  // not about the caller, and putting it on screen helps nobody.
  it('leaves a 500 with its own message rather than relaying upstream prose', async () => {
    gatewayFetch.mockRejectedValueOnce(
      new MicroserviceError('Failed to request the corporate CLA signature', 500, 'UPSTREAM_ERROR', {
        service: 'org_cla_service',
        errorBody: JSON.stringify({ message: 'panic: nil pointer dereference in signature repository' }),
      })
    );

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).rejects.toThrow(/Failed to request the corporate CLA/);
  });

  // No pre-gate on the organization's compliance status: the CLA service screens on every
  // request, and the status on an existing agreement row cannot answer for an organization that
  // holds none — which is the population this flow exists for.
  it('never reads the organization CLA list before requesting the signature', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest());

    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/cla-groups'), expect.anything());
  });
});

// ---------------------------------------------------------------------------
// Approval list (#1985)
// ---------------------------------------------------------------------------

/**
 * Stages the two upstream calls a read makes, in order: the organization's own agreement list
 * (which is what binds the signature to the caller's organization), then the CCLA the approval
 * list lives on.
 */
function stageApprovalRead(signature: unknown, entries: EasyClaCompanyClaGroup[] = [upstreamEntry()]): void {
  gatewayFetch.mockResolvedValueOnce(upstreamList(...entries)).mockResolvedValueOnce({ signatures: signature === null ? [] : [signature] });
}

/** One read-path approval item: a value plus the date the producer stamped it with. */
function item(value: string, dateAdded?: string): EasyClaApprovalItem {
  return { approval_item: value, ...(dateAdded ? { date_added: dateAdded } : {}) };
}

function corporateSignature(overrides: Partial<EasyClaCorporateSignature> = {}): EasyClaCorporateSignature {
  return { signatureID: 'signature-uuid-1', claType: 'ccla', signatureSigned: true, signatureApproved: true, ...overrides };
}

describe('OrgClaService.getApprovalList — the upstream calls', () => {
  it('addresses the CCLA read by the project and company ids resolved from the list', async () => {
    stageApprovalRead(corporateSignature());

    await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(gatewayFetch).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'https://gw.example.org/cla-service/v4/signatures/project/a09410000182dD3AAI/company/company-uuid-1',
      expect.objectContaining({ operation: 'org_cla_get_approval_list', service: 'org_cla_service' })
    );
  });

  // The response carries `signatureACL` (the managers by name) and the approval list itself, which
  // is a list of contributors' addresses and domains. The fetch helper logs raw payloads on a
  // non-OK status, so without redaction a routine 403 writes both into application logs.
  it('redacts the response body, which is contributor addresses and a manager roster', async () => {
    stageApprovalRead(corporateSignature());

    await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(gatewayFetch).toHaveBeenNthCalledWith(2, expect.anything(), expect.any(String), expect.objectContaining({ redactResponseBody: true }));
  });

  it("reads with the target user's token while impersonating", async () => {
    isImpersonating.mockReturnValue(true);
    stageApprovalRead(corporateSignature());

    await new OrgClaService().getApprovalList(req({ bearerToken: 'target-token' }), ORG_UID, 'signature-uuid-1');

    expect(gatewayFetch).toHaveBeenNthCalledWith(2, expect.anything(), expect.any(String), expect.objectContaining({ bearerToken: 'target-token' }));
  });
});

// Same gate as the document read, for the same reason: the org grant proves which organization the
// caller may view as, not which signatures belong to it. Without the list lookup the signature id
// alone selects an approval list — and here that list is contributors' email addresses.
describe('OrgClaService.getApprovalList — the organization scope gate', () => {
  it('answers absent for a signature that is not on the organization list', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-this-org-signed' })));

    expect(await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-another-org-signed')).toBeNull();
  });

  it('never reaches the approval endpoint for a signature the organization does not hold', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-this-org-signed' })));

    await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-another-org-signed');

    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  // The endpoint is keyed on (project, company), and one company can hold several CCLAs there
  // under different signing entities — the same reason the list page is keyed on the signature and
  // not the CLA Group. Taking the first result would show one entity's approval list under
  // another's name.
  it('picks the CCLA by signature id rather than taking the first one returned', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-uuid-2' }))).mockResolvedValueOnce({
      signatures: [
        corporateSignature({ signatureID: 'signature-uuid-1', emailApprovalList: [item('wrong@example.com')] }),
        corporateSignature({ signatureID: 'signature-uuid-2', emailApprovalList: [item('right@example.com')] }),
      ],
    });

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-2');

    expect(list?.entries.map((entry) => entry.value)).toEqual(['right@example.com']);
  });
});

describe('OrgClaService.getApprovalList — flattening the six lists', () => {
  it('flattens all six upstream lists into one, tagged by criteria type', async () => {
    stageApprovalRead(
      corporateSignature({
        emailApprovalList: [item('contributor@example.com')],
        domainApprovalList: [item('example.com')],
        githubUsernameApprovalList: [item('octocat')],
        githubOrgApprovalList: [item('example-org')],
        gitlabUsernameApprovalList: [item('example-user')],
        gitlabOrgApprovalList: [item('https://gitlab.com/example-group')],
      })
    );

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list?.entries).toEqual([
      { kind: 'domain', value: 'example.com' },
      { kind: 'email', value: 'contributor@example.com' },
      { kind: 'github-org', value: 'example-org' },
      { kind: 'github-username', value: 'octocat' },
      { kind: 'gitlab-group', value: 'https://gitlab.com/example-group' },
      { kind: 'gitlab-username', value: 'example-user' },
    ]);
  });

  // GitLab calls the thing a group and the producer's field calls it an org. The shared contract
  // follows GitLab's noun because that is the word on the screen, so the two names meet in the
  // service's field table — and a swap there would put GitLab groups under the GitHub org label.
  it('reads a GitLab group from the upstream field spelled "org"', async () => {
    stageApprovalRead(corporateSignature({ gitlabOrgApprovalList: [item('https://gitlab.com/example-group')] }));

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list?.entries).toEqual([{ kind: 'gitlab-group', value: 'https://gitlab.com/example-group' }]);
  });

  it('carries the date the producer stamped an entry with', async () => {
    stageApprovalRead(corporateSignature({ emailApprovalList: [item('contributor@example.com', '2026-03-04T10:00:00Z')] }));

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list?.entries[0].addedOn).toBe('2026-03-04T10:00:00Z');
  });

  // An absent date must stay absent: the column renders it as unknown, whereas a substituted date
  // would state that the rule was added today.
  it('omits the date when the producer has none for the entry', async () => {
    stageApprovalRead(corporateSignature({ emailApprovalList: [item('contributor@example.com')] }));

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list?.entries[0].addedOn).toBeUndefined();
    expect('addedOn' in list!.entries[0]).toBe(false);
  });

  // `x-nullable: true` upstream, so an empty list arrives as `null` rather than `[]`.
  it('reads a null list as empty rather than failing', async () => {
    stageApprovalRead(corporateSignature({ emailApprovalList: null, domainApprovalList: [item('example.com')] }));

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list?.entries).toEqual([{ kind: 'domain', value: 'example.com' }]);
  });

  // Not a rule: it cannot be matched against, and it cannot be removed either, since the producer
  // validates a removal by the same rules as an addition and would reject the empty string. A row
  // whose only control is guaranteed to fail is worse than no row.
  it('drops an entry with no value rather than rendering an unremovable row', async () => {
    stageApprovalRead(corporateSignature({ emailApprovalList: [item(''), item('   '), item('contributor@example.com')] }));

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list?.entries).toEqual([{ kind: 'email', value: 'contributor@example.com' }]);
  });
});

describe('OrgClaService.getApprovalList — empty versus failed', () => {
  it('treats an empty signatures array as no matching CCLA, not an error', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ signatures: [] });

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list?.entries).toEqual([]);
  });

  it('rejects a null corporate-signature body rather than reading it as an empty list', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce(null);

    await expect(new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1')).rejects.toMatchObject({
      code: 'UPSTREAM_INVALID_RESPONSE',
    });
  });

  it('rejects a response whose signatures field is missing', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ claType: 'ccla' });

    await expect(new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1')).rejects.toMatchObject({
      code: 'UPSTREAM_INVALID_RESPONSE',
    });
  });

  it('rejects a response whose signatures field is not an array', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ signatures: 'not-a-list' });

    await expect(new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1')).rejects.toMatchObject({
      code: 'UPSTREAM_INVALID_RESPONSE',
    });
  });

  it('answers an empty list for an agreement whose CCLA the read path did not return', async () => {
    // The producer selects the signed and approved CCLA for the project, and a signature that is
    // signed but not approved legitimately matches nothing there. That is an empty list, not a
    // failure — and not a 404 either, since the agreement itself exists.
    stageApprovalRead(null);

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list).toEqual({ signatureId: 'signature-uuid-1', entries: [], canEdit: true });
  });
});

describe('OrgClaService.getApprovalList — an unsigned agreement', () => {
  it('answers an empty, uneditable list without asking upstream for one', async () => {
    // Only the list is staged: reaching the approval endpoint at all is the failure this guards.
    // There is no CCLA for the producer to attach a rule to, so the list is not editable either.
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signed: false })));

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list).toEqual({ signatureId: 'signature-uuid-1', entries: [], canEdit: false });
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  // The truthful empty rather than a 404, which would read to a direct caller as "no such
  // agreement" when the agreement is real and simply unsigned.
  it('does not answer absent for an unsigned agreement', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signed: false })));

    expect(await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1')).not.toBeNull();
  });

  // A sanctioned entity may still have signed. Gating the list on the display status would hide a
  // signed agreement's rules behind "sign this CLA first", which is untrue — sanctions messaging
  // is a separate surface.
  it('serves the list of a signed agreement whose entity is sanctioned', async () => {
    stageApprovalRead(corporateSignature({ emailApprovalList: [item('contributor@example.com')] }), [upstreamEntry({ signed: true, sanctioned: true })]);

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(list?.entries).toHaveLength(1);
  });
});

/**
 * The producer's rule is membership of the CCLA's own ACL, matched on LF username, and it
 * explicitly refuses to let an organization-level admin scope stand in for it. So an org admin who
 * can load this page is not thereby able to write, and the client cannot work that out for itself.
 */
describe('OrgClaService.getApprovalList — who may write', () => {
  it('grants write access to a caller named on the agreement roster', async () => {
    getUsernameFromAuth.mockResolvedValue('aporter');
    stageApprovalRead(corporateSignature());

    expect((await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1'))?.canEdit).toBe(true);
  });

  it('withholds write access from an org viewer who is not a CLA manager on it', async () => {
    getUsernameFromAuth.mockResolvedValue('someone-else');
    stageApprovalRead(corporateSignature());

    expect((await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1'))?.canEdit).toBe(false);
  });

  it('matches the roster case-insensitively, since the two sources spell usernames differently', async () => {
    getUsernameFromAuth.mockResolvedValue('APorter');
    stageApprovalRead(corporateSignature());

    expect((await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1'))?.canEdit).toBe(true);
  });

  it('withholds write access when the caller has no resolvable username', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    stageApprovalRead(corporateSignature());

    expect((await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1'))?.canEdit).toBe(false);
  });

  // Deliberately open, not closed: the producer is the authority and rejects the write regardless,
  // so failing open costs a CLA manager one clear error message where failing closed would hide
  // the only approval-list controls Self Serve has from someone entitled to use them.
  it('fails open when upstream sent no roster at all', async () => {
    getUsernameFromAuth.mockResolvedValue('someone-else');
    stageApprovalRead(corporateSignature(), [upstreamEntry({ claManagers: undefined })]);

    expect((await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1'))?.canEdit).toBe(true);
  });

  // An empty roster is upstream stating that nobody may write, which is different from not having
  // told us — so this one closes where the case above opens.
  it('withholds write access when the roster is empty', async () => {
    stageApprovalRead(corporateSignature(), [upstreamEntry({ claManagers: [] })]);

    expect((await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1'))?.canEdit).toBe(false);
  });

  // The roster is what `canEdit` is computed from, and it is also the thing the list mapper drops.
  // Computing the flag must not be what puts the identities back on the wire.
  it('carries no manager identity into the approval-list response', async () => {
    stageApprovalRead(corporateSignature());

    const list = await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain('aporter');
    expect(serialized).not.toContain('user-uuid-1');
  });
});

/**
 * Stages the three upstream calls a write makes: the organization's list (which resolves the ids
 * and binds the signature to the caller's organization), the PUT itself, then the CCLA re-read
 * that recovers the dates the write response drops.
 *
 * Three and not four: the re-read reuses the context the resolution already produced rather than
 * fetching the organization's list a second time.
 */
function stageApprovalWrite(writeResult: unknown, refreshed: unknown = corporateSignature(), entries: EasyClaCompanyClaGroup[] = [upstreamEntry()]): void {
  gatewayFetch
    .mockResolvedValueOnce(upstreamList(...entries))
    .mockResolvedValueOnce(writeResult)
    .mockResolvedValueOnce({ signatures: refreshed === null ? [] : [refreshed] });
}

const ADD_ONE = { add: [{ kind: 'email' as const, value: 'contributor@example.com' }], remove: [] };

describe('OrgClaService.updateApprovalList — the upstream call', () => {
  it('addresses the write by all three resolved ids', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(gatewayFetch).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'https://gw.example.org/cla-service/v4/signatures/project/a09410000182dD3AAI/company/company-uuid-1/clagroup/cla-group-uuid-1/approval-list',
      expect.objectContaining({ method: 'PUT', operation: 'org_cla_update_approval_list' })
    );
  });

  // The success body is the whole CCLA signature, which carries the agreement's ACL — every CLA
  // manager by id and LF username. A non-OK body names the authenticated user instead. A 403 here
  // is an expected outcome rather than an exceptional one, so the routine case is the one that
  // would be writing identities into the logs.
  it('redacts the response body on the write too', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(gatewayFetch).toHaveBeenNthCalledWith(2, expect.anything(), expect.any(String), expect.objectContaining({ redactResponseBody: true }));
  });

  // The route blocks this path during impersonation, so there is no impersonated identity to
  // forward. Reads forward one; a write must not — an approval-list change is recorded in the
  // agreement's activity log, and forwarding would attribute it to the impersonated manager.
  it('forwards no bearer token on the write', async () => {
    isImpersonating.mockReturnValue(true);
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req({ bearerToken: 'target-token' }), ORG_UID, 'signature-uuid-1', ADD_ONE);

    const [, , options] = gatewayFetch.mock.calls[1];
    expect(options.bearerToken).toBeUndefined();
  });

  it('lets an upstream refusal propagate rather than reporting a write that did not happen', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockRejectedValueOnce(new Error('forbidden'));

    await expect(new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE)).rejects.toThrow('forbidden');
  });
});

/**
 * The producer's body is PascalCase (`json:"AddEmailApprovalList"`), which is not a detail that can
 * be got approximately right: a camelCase key arrives absent, so every array would be empty and
 * the producer would reject the request as empty — or, worse for a removal, silently do nothing.
 */
describe('OrgClaService.updateApprovalList — the request body', () => {
  /** The body of the PUT, which is the second of the four staged calls. */
  function sentBody(): Record<string, string[]> {
    return gatewayFetch.mock.calls[1][2].body;
  }

  it('sends an addition on the Add array of its criteria type', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(sentBody()).toEqual({ AddEmailApprovalList: ['contributor@example.com'] });
  });

  it('maps each of the six criteria types onto its own upstream array', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', {
      add: [
        { kind: 'domain', value: 'example.com' },
        { kind: 'email', value: 'contributor@example.com' },
        { kind: 'github-org', value: 'example-org' },
        { kind: 'github-username', value: 'octocat' },
        { kind: 'gitlab-group', value: 'https://gitlab.com/example-group' },
        { kind: 'gitlab-username', value: 'example-user' },
      ],
      remove: [],
    });

    expect(sentBody()).toEqual({
      AddDomainApprovalList: ['example.com'],
      AddEmailApprovalList: ['contributor@example.com'],
      AddGithubOrgApprovalList: ['example-org'],
      AddGithubUsernameApprovalList: ['octocat'],
      AddGitlabOrgApprovalList: ['https://gitlab.com/example-group'],
      AddGitlabUsernameApprovalList: ['example-user'],
    });
  });

  // A GitLab group goes on `AddGitlabOrgApprovalList`, not `AddGitlabGroupApprovalList`. A field
  // name the producer does not recognise is dropped from the body rather than rejected, so this
  // mistake would look like a successful no-op.
  it('sends a GitLab group on the upstream array spelled "org"', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', {
      add: [{ kind: 'gitlab-group', value: 'https://gitlab.com/example-group' }],
      remove: [],
    });

    expect(sentBody()).toEqual({ AddGitlabOrgApprovalList: ['https://gitlab.com/example-group'] });
  });

  // An edit is a removal and an addition in one request — the removal half is what invalidates the
  // acknowledgements, and sending them separately would leave the list briefly missing a rule.
  it('sends an edit as a removal and an addition in one request', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', {
      add: [{ kind: 'domain', value: 'new.example.com' }],
      remove: [{ kind: 'domain', value: 'old.example.com' }],
    });

    expect(gatewayFetch).toHaveBeenCalledTimes(3);
    expect(sentBody()).toEqual({
      AddDomainApprovalList: ['new.example.com'],
      RemoveDomainApprovalList: ['old.example.com'],
    });
  });

  it('trims values, so a pasted trailing space is not stored as part of the rule', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', {
      add: [{ kind: 'email', value: '  contributor@example.com  ' }],
      remove: [],
    });

    expect(sentBody()).toEqual({ AddEmailApprovalList: ['contributor@example.com'] });
  });

  // The producer appends adds to the stored list without de-duplicating against the request
  // itself, so a value sent twice is a rule stored twice — and then needs removing twice.
  it('deduplicates a value repeated within one request', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', {
      add: [
        { kind: 'email', value: 'contributor@example.com' },
        { kind: 'email', value: ' contributor@example.com ' },
      ],
      remove: [],
    });

    expect(sentBody()).toEqual({ AddEmailApprovalList: ['contributor@example.com'] });
  });

  // Every field is optional upstream and the producer requires at least one non-empty array, so an
  // untouched list must not appear in the body at all.
  it('sends no array for a criteria type the delta does not touch', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(Object.keys(sentBody())).toEqual(['AddEmailApprovalList']);
  });
});

describe('OrgClaService.updateApprovalList — what it answers with', () => {
  // The write response carries values without dates, so the list is re-read to recover them.
  // One extra upstream GET on a button press, not on a render.
  // The re-read reuses the context the write already resolved. Re-resolving it would refetch the
  // organization's whole agreement list to arrive at three ids that were already in hand.
  it('costs three upstream calls, not four', async () => {
    stageApprovalWrite({});

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(gatewayFetch).toHaveBeenCalledTimes(3);
    expect(gatewayFetch.mock.calls.filter(([, url]) => String(url).endsWith('/cla-groups'))).toHaveLength(1);
  });

  it('re-reads the list so the new rows carry their dates', async () => {
    stageApprovalWrite(
      { emailApprovalList: ['contributor@example.com'] },
      corporateSignature({ emailApprovalList: [item('contributor@example.com', '2026-03-04T10:00:00Z')] })
    );

    const result = await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(result).toEqual({
      outcome: 'updated',
      list: { signatureId: 'signature-uuid-1', entries: [{ kind: 'email', value: 'contributor@example.com', addedOn: '2026-03-04T10:00:00Z' }], canEdit: true },
    });
  });

  // The write already succeeded. Reporting the re-read's failure as a failed write would invite a
  // CLA manager to retry a removal that has already invalidated acknowledgements — so the fallback
  // is the write's own post-update lists, dateless.
  it('still reports success when the re-read fails, falling back to the write response', async () => {
    gatewayFetch
      .mockResolvedValueOnce(upstreamList(upstreamEntry()))
      .mockResolvedValueOnce({ emailApprovalList: ['contributor@example.com'] })
      .mockRejectedValueOnce(new Error('re-read exploded'));

    const result = await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(result).toEqual({
      outcome: 'updated',
      list: { signatureId: 'signature-uuid-1', entries: [{ kind: 'email', value: 'contributor@example.com' }], canEdit: true },
    });
  });

  it('does not invent an empty list when the write body is missing and the re-read fails', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('re-read exploded'));

    await expect(new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE)).rejects.toThrow('re-read exploded');
  });

  it('does not invent an empty list when the write body carries no lists and the re-read fails', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('re-read exploded'));

    await expect(new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE)).rejects.toThrow('re-read exploded');
  });

  it('treats a write body whose lists are null as empty, not as missing', async () => {
    gatewayFetch
      .mockResolvedValueOnce(upstreamList(upstreamEntry()))
      .mockResolvedValueOnce({ emailApprovalList: null, domainApprovalList: null })
      .mockRejectedValueOnce(new Error('re-read exploded'));

    const result = await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(result).toEqual({
      outcome: 'updated',
      list: { signatureId: 'signature-uuid-1', entries: [], canEdit: true },
    });
  });

  it('flattens the write response, whose lists are flat strings rather than dated objects', async () => {
    gatewayFetch
      .mockResolvedValueOnce(upstreamList(upstreamEntry()))
      .mockResolvedValueOnce({ emailApprovalList: ['b@example.com', 'a@example.com'], domainApprovalList: ['example.com'] })
      .mockRejectedValueOnce(new Error('re-read exploded'));

    const result = await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(result.outcome === 'updated' && result.list.entries).toEqual([
      { kind: 'domain', value: 'example.com' },
      { kind: 'email', value: 'a@example.com' },
      { kind: 'email', value: 'b@example.com' },
    ]);
  });
});

describe('OrgClaService.updateApprovalList — the outcomes that are not failures', () => {
  it('reports not-found for a signature this organization does not hold', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-this-org-signed' })));

    expect(await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-another-org-signed', ADD_ONE)).toEqual({ outcome: 'not-found' });
  });

  it('never reaches the write endpoint for a signature the organization does not hold', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-this-org-signed' })));

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-another-org-signed', ADD_ONE);

    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('reports not-signed for an agreement with no CCLA to attach a rule to', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signed: false })));

    expect(await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE)).toEqual({ outcome: 'not-signed' });
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('reports forbidden when the caller is not a CLA manager on the agreement', async () => {
    getUsernameFromAuth.mockResolvedValue('someone-else');
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry()));

    expect(await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE)).toEqual({ outcome: 'forbidden' });
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('never reaches the write endpoint when the caller is not a CLA manager on it', async () => {
    getUsernameFromAuth.mockResolvedValue('someone-else');
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry()));

    await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(gatewayFetch).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/approval-list'), expect.anything());
  });
});

// The row is real and the caller may see it; it simply cannot be addressed on the approval-list
// endpoints. A 502 rather than a 404, because that is an upstream data problem and not something
// the caller can fix by asking differently.
describe('OrgClaService — an approval list that cannot be addressed', () => {
  it.each([
    ['the CLA Group id', { claGroupID: undefined }],
    ['the internal company id', { companyID: undefined }],
    ['any project SFID and the foundation id', { projects: [{ projectName: 'Cascade' }], foundationSFID: undefined }],
  ])('rejects a read when upstream omits %s', async (_case, overrides) => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry(overrides)));

    await expect(new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1')).rejects.toMatchObject({ code: 'UPSTREAM_INVALID_RESPONSE' });
  });

  it('rejects a write before calling upstream when the ids cannot be resolved', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ companyID: undefined })));

    await expect(new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE)).rejects.toMatchObject({
      code: 'UPSTREAM_INVALID_RESPONSE',
    });
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  // GetCompanyClaGroups drops the foundation marker from projects[], so a foundation-level group
  // arrives with no project SFID and a present foundationSFID. GetClaGroupIDForProject already
  // falls back to a foundation lookup, so that id is a valid path segment.
  it('falls back to the foundation id when no project SFID is present', async () => {
    stageApprovalRead(corporateSignature(), [upstreamEntry({ projects: [{ projectName: 'Cascade' }] })]);

    await new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1');

    expect(gatewayFetch).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'https://gw.example.org/cla-service/v4/signatures/project/a09410000182dD2AAI/company/company-uuid-1',
      expect.objectContaining({ operation: 'org_cla_get_approval_list' })
    );
  });
});

describe('OrgClaService.getCclaPreview — the watermarked review copy', () => {
  const PREVIEW_GROUP = '7f3a1c22-9d51-4a8e-b0c6-2e4f81d9a733';

  it('calls the producer preview with corporate type and watermark pinned', async () => {
    const pdf = Buffer.from('%PDF-1.4 review-copy');
    gatewayFetchBinary.mockResolvedValueOnce(pdf);

    await expect(new OrgClaService().getCclaPreview(req(), PREVIEW_GROUP)).resolves.toEqual(pdf);

    expect(gatewayFetchBinary).toHaveBeenCalledTimes(1);
    expect(gatewayFetchBinary).toHaveBeenCalledWith(
      expect.anything(),
      `https://gw.example.org/cla-service/v4/template/${PREVIEW_GROUP}/preview?claType=ccla&watermark=true`,
      expect.objectContaining({ operation: 'org_cla_ccla_preview', redactResponseBody: true })
    );
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('does not list the organization agreements first', async () => {
    gatewayFetchBinary.mockResolvedValueOnce(Buffer.from('%PDF-1.4'));

    await new OrgClaService().getCclaPreview(req(), PREVIEW_GROUP);

    expect(gatewayFetch).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/cla-groups'), expect.anything());
  });

  it('relays a missing template as the upstream status', async () => {
    gatewayFetchBinary.mockRejectedValueOnce(
      new MicroserviceError('Failed to fetch CCLA review copy: 400 Bad Request', 400, 'UPSTREAM_ERROR', { service: 'org_cla_service' })
    );

    await expect(new OrgClaService().getCclaPreview(req(), PREVIEW_GROUP)).rejects.toMatchObject({ statusCode: 400, code: 'UPSTREAM_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// CLA Managers (#1984)
// ---------------------------------------------------------------------------

function upstreamManager(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lf_username: 'aporter',
    name: 'Ada Porter',
    email: 'ada.porter@example.org',
    user_sfid: '0054100000Te2ovAAB',
    added_on: '2024-05-02T11:00:00Z',
    project_id: 'project-uuid-1',
    project_sfid: 'a09410000182dD3AAI',
    organization_id: 'company-uuid-1',
    organization_sfid: ORG_UID,
    cla_group_name: 'Nimbus Foundation CLA',
    ...overrides,
  };
}

describe('OrgClaService.getManagers', () => {
  it('maps only the four fields the tab renders, and drops the Salesforce user id', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ list: [upstreamManager()] });

    const result = await new OrgClaService().getManagers(req(), ORG_UID, 'signature-uuid-1');

    expect(result?.managers).toEqual([{ lfUsername: 'aporter', name: 'Ada Porter', email: 'ada.porter@example.org', addedOn: '2024-05-02T11:00:00Z' }]);
  });

  it('omits a missing name rather than mapping it to an empty string', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ list: [upstreamManager({ name: '  ' })] });

    const result = await new OrgClaService().getManagers(req(), ORG_UID, 'signature-uuid-1');

    expect(result?.managers[0]).not.toHaveProperty('name');
    expect(result?.managers[0].lfUsername).toBe('aporter');
  });

  it('omits a missing address rather than blank-filling it', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ list: [upstreamManager({ email: '' })] });

    expect((await new OrgClaService().getManagers(req(), ORG_UID, 'signature-uuid-1'))?.managers[0]).not.toHaveProperty('email');
  });

  it('drops a record with no LF username, which no removal could address', async () => {
    gatewayFetch
      .mockResolvedValueOnce(upstreamList(upstreamEntry()))
      .mockResolvedValueOnce({ list: [upstreamManager({ lf_username: '' }), upstreamManager()] });

    expect((await new OrgClaService().getManagers(req(), ORG_UID, 'signature-uuid-1'))?.managers).toHaveLength(1);
  });

  it('drops a null row rather than throwing while reading its LF username', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ list: [null, upstreamManager()] });

    expect((await new OrgClaService().getManagers(req(), ORG_UID, 'signature-uuid-1'))?.managers).toHaveLength(1);
  });

  it('lists managers for an agreement covering neither a project nor a foundation, which only the writes need', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ projects: [], foundationSFID: '' }))).mockResolvedValueOnce({ list: [upstreamManager()] });

    expect((await new OrgClaService().getManagers(req(), ORG_UID, 'signature-uuid-1'))?.managers).toHaveLength(1);
  });

  it('reads an absent list as an agreement with no managers', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({});

    expect((await new OrgClaService().getManagers(req(), ORG_UID, 'signature-uuid-1'))?.managers).toEqual([]);
  });

  it('calls upstream with the internal company id, never the Salesforce organization id', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ list: [] });

    await new OrgClaService().getManagers(req(), ORG_UID, 'signature-uuid-1');

    expect(gatewayFetch).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'https://gw.example.org/cla-service/v4/company/company-uuid-1/cla-group/cla-group-uuid-1/cla-managers',
      expect.objectContaining({ operation: 'org_cla_list_managers' })
    );
  });

  it('never lets the manager list body reach a log', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({ list: [] });

    await new OrgClaService().getManagers(req(), ORG_UID, 'signature-uuid-1');

    expect(gatewayFetch).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), expect.objectContaining({ redactResponseBody: true }));
  });

  it('answers an agreement the organization does not hold as absent, without calling upstream', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-this-org-signed' })));

    expect(await new OrgClaService().getManagers(req(), ORG_UID, 'signature-another-org-signed')).toBeNull();
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('/cla-managers'), expect.anything());
  });
});

describe('OrgClaService.addManager', () => {
  const request = { firstName: 'Ada', lastName: 'Porter', email: 'ada.porter@example.org' };

  it('sends camelCase and renames the address field, unlike its snake_case neighbours', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce(upstreamManager());

    await new OrgClaService().addManager(req(), ORG_UID, 'signature-uuid-1', request);

    expect(gatewayFetch).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.stringContaining('/company/company-uuid-1/project/a09410000182dD3AAI/cla-manager'),
      expect.objectContaining({ method: 'POST', body: { firstName: 'Ada', lastName: 'Porter', userEmail: 'ada.porter@example.org' } })
    );
  });

  it('keys the write on a covered project, not on the foundation', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce(upstreamManager());

    await new OrgClaService().addManager(req(), ORG_UID, 'signature-uuid-1', request);

    const url = gatewayFetch.mock.calls[1][1] as string;
    expect(url).toContain('/project/a09410000182dD3AAI/');
    expect(url).not.toContain('a09410000182dD2AAI');
  });

  it('picks the same project every time regardless of the order upstream sent them', async () => {
    const reversed = upstreamEntry({
      projects: [
        { projectSFID: 'a09410000182dD4AAI', projectName: 'Driftwood' },
        { projectSFID: 'a09410000182dD3AAI', projectName: 'Cascade' },
      ],
    });
    gatewayFetch.mockResolvedValueOnce(upstreamList(reversed)).mockResolvedValueOnce(upstreamManager());

    await new OrgClaService().addManager(req(), ORG_UID, 'signature-uuid-1', request);

    expect(gatewayFetch.mock.calls[1][1]).toContain('/project/a09410000182dD3AAI/');
  });

  it('falls back to the foundation only when the agreement covers no project', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ projects: [] }))).mockResolvedValueOnce(upstreamManager());

    await new OrgClaService().addManager(req(), ORG_UID, 'signature-uuid-1', request);

    expect(gatewayFetch.mock.calls[1][1]).toContain('/project/a09410000182dD2AAI/');
  });

  it('fails rather than compose an empty project segment when the row names no project at all', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ projects: [], foundationSFID: '' })));

    await expect(new OrgClaService().addManager(req(), ORG_UID, 'signature-uuid-1', request)).rejects.toThrow(/missing its project id/);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a 200 carrying no manager record rather than reporting an anonymous success', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce({});

    await expect(new OrgClaService().addManager(req(), ORG_UID, 'signature-uuid-1', request)).rejects.toThrow(/no manager record/);
  });

  it('answers an agreement the organization does not hold as absent, without calling upstream', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-this-org-signed' })));

    expect(await new OrgClaService().addManager(req(), ORG_UID, 'signature-other', request)).toBeNull();
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });
});

describe('OrgClaService.removeManager', () => {
  it('addresses the removal by LF username on a covered project', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce(null);

    await new OrgClaService().removeManager(req(), ORG_UID, 'signature-uuid-1', 'aporter');

    expect(gatewayFetch).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'https://gw.example.org/cla-service/v4/company/company-uuid-1/project/a09410000182dD3AAI/cla-manager/aporter',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('answers an agreement the organization does not hold as absent, without calling upstream', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ signatureID: 'signature-this-org-signed' })));

    expect(await new OrgClaService().removeManager(req(), ORG_UID, 'signature-other', 'aporter')).toBe(false);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });

  it('fails rather than compose an empty project segment when the row names no project at all', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ projects: [], foundationSFID: '' })));

    await expect(new OrgClaService().removeManager(req(), ORG_UID, 'signature-uuid-1', 'aporter')).rejects.toThrow(/missing its project id/);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Refusals — classified name only, refusal sentence never logged
// ---------------------------------------------------------------------------

const REFUSAL_SENTENCE = 'user jdelacroix does not have an LF Login account for company company-uuid-1 on project a09410000182dD3AAI';

function upstreamRefusal(status = 400, body: string = JSON.stringify({ Message: REFUSAL_SENTENCE })): MicroserviceError {
  return new MicroserviceError(`Failed: ${status}`, status, 'UPSTREAM_ERROR', { operation: 'op', service: 'cla', errorBody: body });
}

function everythingLogged(error: unknown): string {
  const contextual = error instanceof MicroserviceError ? error.getLogContext() : {};
  return JSON.stringify({ contextual, serialized: customErrorSerializer(error), message: (error as Error)?.message });
}

describe.each([
  [
    'addManager',
    (service: InstanceType<typeof OrgClaService>) =>
      service.addManager(req(), ORG_UID, 'signature-uuid-1', { firstName: 'Ada', lastName: 'Porter', email: 'ada.porter@example.org' }),
  ],
  ['removeManager', (service: InstanceType<typeof OrgClaService>) => service.removeManager(req(), ORG_UID, 'signature-uuid-1', 'jdelacroix')],
] as const)('%s refusals', (_name, invoke) => {
  async function refusalFrom(status: number, body?: string): Promise<unknown> {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockRejectedValueOnce(upstreamRefusal(status, body));
    return invoke(new OrgClaService()).then(
      () => undefined,
      (error: unknown) => error
    );
  }

  it.each([
    ['no-lf-login', 400, JSON.stringify({ Message: REFUSAL_SENTENCE })],
    ['last-manager', 400, JSON.stringify({ Message: "Can't delete the only remaining CLA Manager for this CLA Group" })],
    ['not-authorized', 400, JSON.stringify({ Message: 'user aporter is not authorized for project a09410000182dD3AAI' })],
    ['already-manager', 409, ''],
    ['unknown', 400, JSON.stringify({ Message: 'the request could not be completed at this time' })],
  ] as const)('classifies the refusal as %s and carries only that name', async (expected, status, body) => {
    const error = (await refusalFrom(status, body)) as MicroserviceError;

    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error.errorBody).toEqual({ error: expected });
  });

  it('publishes no part of the refusal sentence to any log surface', async () => {
    const error = await refusalFrom(400);
    const logged = everythingLogged(error);

    expect(logged).not.toContain(REFUSAL_SENTENCE);
    expect(logged).not.toContain('jdelacroix');
    expect(logged).not.toContain('company-uuid-1');
    expect(logged).not.toContain('a09410000182dD3AAI');
    expect(logged).toContain('no-lf-login');
  });

  it('keeps the sentence out of the message the failure log line is built from', async () => {
    const error = (await refusalFrom(400)) as Error;

    expect(error.message).not.toContain(REFUSAL_SENTENCE);
    expect(error.message).toContain('no-lf-login');
  });

  it('asks the fetch helper to keep the body out of the log while still attaching it', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce(upstreamManager());

    await invoke(new OrgClaService()).catch(() => undefined);

    expect(gatewayFetch).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), expect.objectContaining({ redactResponseBodyFromLogs: true }));
  });

  it('leaves a transport failure alone rather than dressing it as a refusal', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockRejectedValueOnce(upstreamRefusal(504, ''));

    const error = (await invoke(new OrgClaService()).then(
      () => undefined,
      (caught: unknown) => caught
    )) as MicroserviceError;

    expect(error.statusCode).toBe(504);
    expect(error.errorBody).toBe('');
  });
});
