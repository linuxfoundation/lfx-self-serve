// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The service reaches the shared utils barrel for the approval-list sort, and that barrel pulls in
// Angular-dependent siblings. Without the compiler the suite fails to collect at all.
import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import type { EasyClaApprovalItem, EasyClaCompanyClaGroup, EasyClaCompanyClaGroupList, EasyClaCorporateSignature } from '../types/cla.types';

// `getUsernameFromAuth` is a spy because the approval list's `canEdit` is decided by matching the
// signed-in username against the agreement's CLA manager roster, so the caller's identity is an
// input to these tests rather than a fixture.
const { gatewayFetch, isImpersonating, getUsernameFromAuth } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  isImpersonating: vi.fn(() => false),
  getUsernameFromAuth: vi.fn(async () => 'aporter' as string | null),
}));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../helpers/cla-service-url.helper', () => ({ claServiceBaseUrl: () => 'https://gw.example.org/cla-service' }));
vi.mock('../utils/auth-helper', () => ({ isImpersonating, getUsernameFromAuth }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const { OrgClaService } = await import('./org-cla.service');

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

  // The producer passes the signature's own signed flag through and its tests pin a returned
  // row whose flag is false, so this list is not exclusively signed agreements. Calling one
  // signed would state that an organization has signed something it has not.
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

  it('reports success with an empty list when upstream answers the write with no body', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry())).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('re-read exploded'));

    const result = await new OrgClaService().updateApprovalList(req(), ORG_UID, 'signature-uuid-1', ADD_ONE);

    expect(result).toEqual({ outcome: 'updated', list: { signatureId: 'signature-uuid-1', entries: [], canEdit: true } });
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

// Three outcomes, because they map to three different HTTP answers and two of them are ordinary.
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
});

// The row is real and the caller may see it; it simply cannot be addressed on the approval-list
// endpoints. A 502 rather than a 404, because that is an upstream data problem and not something
// the caller can fix by asking differently.
describe('OrgClaService — an approval list that cannot be addressed', () => {
  it.each([
    ['the CLA Group id', { claGroupID: undefined }],
    ['the internal company id', { companyID: undefined }],
    ['any project SFID', { projects: [{ projectName: 'Cascade' }] }],
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

  // A foundation id is not a project id, and the producer's lookup would 404 on it — so falling
  // back to it would turn a clear 502 into a confusing not-found.
  it('does not fall back to the foundation id when no project SFID is present', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamList(upstreamEntry({ projects: [{ projectName: 'Cascade' }] })));

    await expect(new OrgClaService().getApprovalList(req(), ORG_UID, 'signature-uuid-1')).rejects.toThrow();
    expect(gatewayFetch).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('a09410000182dD2AAI'), expect.anything());
  });
});
