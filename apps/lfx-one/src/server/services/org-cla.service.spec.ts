// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The service now reaches the shared utils barrel for the refusal classifier, and that barrel
// pulls in partially-compiled Angular declarations. Same reason the route specs import it.
import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import type { EasyClaCompanyClaGroup, EasyClaCompanyClaGroupList } from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { customErrorSerializer } from '../helpers/error-serializer';

const { gatewayFetch, isImpersonating } = vi.hoisted(() => ({ gatewayFetch: vi.fn(), isImpersonating: vi.fn(() => false) }));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../helpers/cla-service-url.helper', () => ({ claServiceBaseUrl: () => 'https://gw.example.org/cla-service' }));
vi.mock('../utils/auth-helper', () => ({ isImpersonating }));
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
