// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import type * as ClaIdentifierUtils from '../../../../../packages/shared/src/utils/cla-identifier.utils';
import type { MicroserviceError as MicroserviceErrorType } from '../errors';
import type { EasyClaCompanyClaGroup, EasyClaCompanyClaGroupList } from '../types/cla.types';

const { gatewayFetch, isImpersonating, loggerWarning } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  isImpersonating: vi.fn(() => false),
  loggerWarning: vi.fn(),
}));

// The shared utils barrel reaches Angular through unrelated siblings (form/meeting/vote), which the
// node test environment cannot compile. Only the real identifier helper is wanted here — pulled
// from its own module via `importActual` rather than restated, so the comparison under test is the
// one that ships. Same approach `rewards-subject.spec.ts` uses for the Salesforce pattern.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await vi.importActual<typeof ClaIdentifierUtils>('../../../../../packages/shared/src/utils/cla-identifier.utils');
  return { isSameClaGroup: actual.isSameClaGroup, canonicalClaGroupId: actual.canonicalClaGroupId };
});

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../helpers/cla-service-url.helper', () => ({ claServiceBaseUrl: () => 'https://gw.example.org/cla-service' }));
vi.mock('../utils/auth-helper', () => ({ isImpersonating }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: loggerWarning, error: vi.fn(), debug: vi.fn(), info: vi.fn() },
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
// Corporate signing hand-off (#1983)
// ---------------------------------------------------------------------------

const CLA_GROUP_ID = '7f3a1c22-9d51-4a8e-b0c6-2e4f81d9a733';
const PROJECT_SFID = 'a09410000182dD3AAI';

/** A request the CLA service would accept. Cases override only what they are about. */
function signRequest(overrides: Record<string, unknown> = {}) {
  return { projectSfid: PROJECT_SFID, claGroupId: CLA_GROUP_ID, authorityAcked: true, embargoAcked: true, ...overrides } as any;
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
          return_url: 'https://app.lfx.dev/org/easycla',
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
      expect.objectContaining({ body: expect.objectContaining({ return_url: 'https://app.lfx.dev/org/easycla' }) })
    );
  });

  // The endpoint accepts these four for the send-by-email and designee paths. This feature
  // implements neither, and `send_as_email` in particular changes what the response means.
  it('sends none of the designee or send-by-email fields', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest());

    const body = gatewayFetch.mock.calls[0][2].body;
    expect(body).not.toHaveProperty('send_as_email');
    expect(body).not.toHaveProperty('authority_name');
    expect(body).not.toHaveProperty('authority_email');
    expect(body).not.toHaveProperty('signing_entity_name');
  });

  it('maps the upstream response onto the shape the client consumes', async () => {
    gatewayFetch.mockResolvedValueOnce(upstreamOk);

    // Just the address. Upstream also returns the signature, CLA group, project and company
    // identifiers; none has a client consumer, and the signature id points at a named person's
    // agreement, so none of them crosses to the browser.
    expect(await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).toEqual({
      signUrl: 'https://docusign.example.org/session/1',
    });
  });

  // An empty signing address is how upstream reports that it emailed a named signatory instead —
  // a shape this route never asks for. Returning it as success would navigate the signatory to
  // this application's own root and read as a completed hand-off.
  it.each([[''], ['   '], [undefined]])('fails rather than succeeding when the signing address is %p', async (signUrl) => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, sign_url: signUrl });

    await expect(new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).rejects.toThrow(/no usable corporate signing session/);
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
    });
  });

  it('does not hand back the signing address when the CLA Group does not match', async () => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, cla_group_id: 'a-different-cla-group-uuid' });

    const outcome = await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest()).catch((error: unknown) => error);

    expect(JSON.stringify(outcome)).not.toContain('docusign.example.org');
  });

  // Absence is not a mismatch. The field is declared always-present upstream, so losing it is an
  // upstream regression rather than evidence of a wrong group, and failing here would dead-end
  // every hand-off the moment it were dropped.
  it.each([[''], ['   '], [undefined]])('proceeds, warning, when the echoed CLA Group is %p', async (claGroupId) => {
    gatewayFetch.mockResolvedValueOnce({ ...upstreamOk, cla_group_id: claGroupId });

    expect(await new OrgClaService().requestCorporateSignature(signReq(), ORG_UID, signRequest())).toEqual({
      signUrl: 'https://docusign.example.org/session/1',
    });
    expect(JSON.stringify(loggerWarning.mock.calls)).toContain('could not verify');
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
