// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ShareKitContent } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

const { resolveVerifiedUserEmailsMock, generateM2MTokenMock } = vi.hoisted(() => ({
  resolveVerifiedUserEmailsMock: vi.fn(),
  generateM2MTokenMock: vi.fn(),
}));

vi.mock('../helpers/user-emails.helper', () => ({ resolveVerifiedUserEmails: resolveVerifiedUserEmailsMock }));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: generateM2MTokenMock }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock('./newsletter-member-benefit.service', () => ({ NewsletterMemberBenefitService: vi.fn() }));
vi.mock('./email-verification.service', () => ({ EmailVerificationService: vi.fn() }));

import type { EmailVerificationService } from './email-verification.service';
import type { NewsletterMemberBenefitService } from './newsletter-member-benefit.service';
import { readShareKitMemberCodes, ShareKitMemberOfferService } from './share-kit-member-offer.service';

const benefit = { membershipSlug: 'example-foundation', membershipName: 'Example', discountLabel: '20% off registration', joinUrl: 'https://example.org/join' };
const kit = { eventSlug: 'example-summit-2027', memberBenefit: benefit } as ShareKitContent;
const code = 'EXAMPLE20';

function request(signedIn: boolean): Request {
  return { oidc: { isAuthenticated: () => signedIn }, log: {} } as unknown as Request;
}

describe('readShareKitMemberCodes', () => {
  it('reads codes keyed by event slug and ignores bad entries', () => {
    const codes = readShareKitMemberCodes(JSON.stringify({ 'example-summit-2027': ' EXAMPLE20 ', 'Bad Slug': 'X', other: 42 }));
    expect([...codes.entries()]).toEqual([['example-summit-2027', 'EXAMPLE20']]);
  });

  it('loads nothing from missing or malformed JSON', () => {
    expect(readShareKitMemberCodes(undefined).size).toBe(0);
    expect(readShareKitMemberCodes('{not json').size).toBe(0);
    expect(readShareKitMemberCodes('["a"]').size).toBe(0);
  });
});

describe('ShareKitMemberOfferService.resolveOffer', () => {
  let resolveEligibility: Mock;
  let service: ShareKitMemberOfferService;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveEligibility = vi.fn();
    resolveVerifiedUserEmailsMock.mockResolvedValue(['jane@acme-motors.example']);
    generateM2MTokenMock.mockResolvedValue('m2m-token');
    service = new ShareKitMemberOfferService(
      { resolveEligibility } as unknown as NewsletterMemberBenefitService,
      {} as EmailVerificationService,
      new Map([['example-summit-2027', code]])
    );
  });

  it('offers nothing when the kit has no member benefit', async () => {
    expect(await service.resolveOffer(request(true), { eventSlug: 'example-summit-2027' } as ShareKitContent)).toBeUndefined();
  });

  it('offers nothing when no code is configured for the event', async () => {
    expect(await service.resolveOffer(request(true), { ...kit, eventSlug: 'other-event' })).toBeUndefined();
  });

  it('asks anonymous visitors to sign in and never looks anything up', async () => {
    expect(await service.resolveOffer(request(false), kit)).toEqual({ status: 'sign_in' });
    expect(resolveEligibility).not.toHaveBeenCalled();
  });

  it('gives the code to a signed-in employee of a member company', async () => {
    resolveEligibility.mockResolvedValue({
      verified_emails: [],
      match: { email: 'jane@acme-motors.example', b2b_org_uid: 'org-1', company_name: 'Acme Motors' },
    });
    expect(await service.resolveOffer(request(true), kit)).toEqual({ status: 'eligible', code, companyName: 'Acme Motors' });
    expect(resolveEligibility).toHaveBeenCalledWith(expect.anything(), 'm2m-token', ['jane@acme-motors.example'], 'example-foundation');
  });

  it('withholds the code from a signed-in visitor at a non-member company', async () => {
    resolveEligibility.mockResolvedValue({ verified_emails: [], match: null, denied_reason: 'not_member_company' });
    const offer = await service.resolveOffer(request(true), kit);
    expect(offer).toEqual({ status: 'not_member' });
    expect(JSON.stringify(offer)).not.toContain(code);
  });

  it('withholds the code when the membership lookup fails', async () => {
    resolveVerifiedUserEmailsMock.mockRejectedValue(new Error('auth-service down'));
    const offer = await service.resolveOffer(request(true), kit);
    expect(offer).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(offer)).not.toContain(code);
  });
});
