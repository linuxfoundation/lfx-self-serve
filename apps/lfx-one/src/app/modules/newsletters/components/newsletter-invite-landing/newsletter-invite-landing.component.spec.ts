// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NewsletterGroupJoinStatus, NewsletterJoinResult } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterInviteLandingComponent } from './newsletter-invite-landing.component';

function status(overrides: Partial<NewsletterGroupJoinStatus> = {}): NewsletterGroupJoinStatus {
  return {
    state: 'eligible',
    group: { uid: 'group-uid', name: 'Acme Foundation Newsletter' },
    foundation: { uid: 'foundation-uid', slug: 'acme-foundation', name: 'Acme Foundation', logo_url: null },
    membership_name: 'Acme Foundation',
    email: 'pat@acme-motors.example',
    company_name: 'Acme Motors',
    ...overrides,
  };
}

const ADDED: NewsletterJoinResult = {
  status: 'added',
  email: 'pat@acme-motors.example',
  committee_name: 'Acme Foundation Newsletter',
  company_name: 'Acme Motors',
};

describe('NewsletterInviteLandingComponent', () => {
  let fixture: ComponentFixture<NewsletterInviteLandingComponent>;
  const newsletterService = { getNewsletterGroupJoinStatus: vi.fn(), joinNewsletterGroupByInvite: vi.fn() };
  const joined = vi.fn();
  const dismissed = vi.fn();
  const find = (id: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  const click = async (id: string) => {
    const host = find(id)!;
    (host.tagName === 'BUTTON' ? host : host.querySelector<HTMLElement>('button, a')!).click();
    await fixture.whenStable();
  };

  async function setup(platformId = 'browser', foundationSlug = 'acme-foundation'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [NewsletterInviteLandingComponent],
      providers: [provideNoopAnimations(), { provide: NewsletterService, useValue: newsletterService }, { provide: PLATFORM_ID, useValue: platformId }],
    }).compileComponents();
    fixture = TestBed.createComponent(NewsletterInviteLandingComponent);
    fixture.componentRef.setInput('committeeUid', 'group-uid');
    fixture.componentRef.setInput('foundationSlug', foundationSlug);
    fixture.componentInstance.joined.subscribe(joined);
    fixture.componentInstance.dismissed.subscribe(dismissed);
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not check the invite during SSR', async () => {
    await setup('server');

    expect(newsletterService.getNewsletterGroupJoinStatus).not.toHaveBeenCalled();
    expect(find('newsletter-invite-landing-loading')).not.toBeNull();
  });

  it('shows a skeleton while loading, then the eligible confirmation', async () => {
    const pending = new Subject<NewsletterGroupJoinStatus>();
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(pending);
    await setup();

    expect(newsletterService.getNewsletterGroupJoinStatus).toHaveBeenCalledWith('group-uid');
    expect(find('newsletter-invite-landing-loading')).not.toBeNull();

    pending.next(status());
    await fixture.whenStable();

    expect(find('newsletter-invite-landing-loading')).toBeNull();
    expect(find('newsletter-invite-landing-card')?.textContent).toContain('Join the Acme Foundation newsletter');
    expect(find('newsletter-invite-landing-eligible')?.textContent).toContain('Acme Motors');
    expect(find('newsletter-invite-landing-email')?.textContent).toBe('pat@acme-motors.example');
    expect(find('newsletter-invite-landing-confirm')).not.toBeNull();
    expect(find('newsletter-invite-landing-recheck')).toBeNull();
    expect(joined).not.toHaveBeenCalled();
  });

  it('re-checks when the invite changes on the same page', async () => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(of(status()));
    await setup();

    fixture.componentRef.setInput('committeeUid', 'other-group-uid');
    await fixture.whenStable();

    expect(newsletterService.getNewsletterGroupJoinStatus).toHaveBeenLastCalledWith('other-group-uid');
    expect(newsletterService.getNewsletterGroupJoinStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores a late reply for a superseded invite', async () => {
    const first = new Subject<NewsletterGroupJoinStatus>();
    const second = new Subject<NewsletterGroupJoinStatus>();
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValueOnce(first).mockReturnValueOnce(second);
    await setup();

    fixture.componentRef.setInput('committeeUid', 'group-uid-2');
    await fixture.whenStable();
    expect(newsletterService.getNewsletterGroupJoinStatus).toHaveBeenLastCalledWith('group-uid-2');

    second.next(status({ group: { uid: 'group-uid-2', name: 'Second Newsletter' }, email: 'sam@acme-motors.example' }));
    await fixture.whenStable();
    first.next(status({ state: 'denied', denied_reason: 'not_member_company' }));
    await fixture.whenStable();

    expect(find('newsletter-invite-landing-email')?.textContent).toBe('sam@acme-motors.example');
    expect(find('newsletter-invite-landing-not-member')).toBeNull();
  });

  it('logs a failed status check', async () => {
    const failure = new HttpErrorResponse({ status: 503 });
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(throwError(() => failure));
    await setup();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[NewsletterInviteLanding]'), failure);
  });

  it('accepts the foundation uid as the drill-down key', async () => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(of(status()));
    await setup('browser', 'foundation-uid');

    expect(find('newsletter-invite-landing-card')).not.toBeNull();
  });

  it('treats an invite for another foundation as invalid', async () => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(of(status()));
    await setup('browser', 'other-foundation');

    expect(find('newsletter-invite-landing-invalid')?.textContent).toContain('This invitation is no longer valid');
    expect(find('newsletter-invite-landing-card')).toBeNull();
  });

  it.each([404, 400])('treats a %s from the status check as an invalid invite', async (httpStatus) => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: httpStatus })));
    await setup();

    expect(find('newsletter-invite-landing-invalid')).not.toBeNull();
    expect(find('newsletter-invite-landing-error')).toBeNull();
  });

  it('shows a retryable error for other failures', async () => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    await setup();

    expect(find('newsletter-invite-landing-error')?.textContent).toContain("We couldn't check your invitation right now.");

    newsletterService.getNewsletterGroupJoinStatus.mockReturnValueOnce(of(status()));
    await click('newsletter-invite-landing-retry');

    expect(newsletterService.getNewsletterGroupJoinStatus).toHaveBeenCalledTimes(2);
    expect(find('newsletter-invite-landing-card')).not.toBeNull();
  });

  it('shows an existing membership without asking to confirm or reloading the page', async () => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(of(status({ state: 'already_member', email: undefined, company_name: undefined })));
    await setup();

    // The page already shows that feed; only a successful join POST asks it to reload.
    expect(joined).not.toHaveBeenCalled();
    expect(find('newsletter-member-benefit-already')).not.toBeNull();
    expect(find('newsletter-invite-landing-card')).toBeNull();
  });

  it.each([
    ['no_company_email', 'newsletter-invite-landing-no-company-email', 'Confirm your company email to join'],
    ['not_member_company', 'newsletter-invite-landing-not-member', 'This newsletter is for Acme Foundation member companies'],
  ] as const)('explains a %s denial and offers to add an email and recheck', async (reason, testId, heading) => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(
      of(status({ state: 'denied', denied_reason: reason, email: undefined, company_name: undefined }))
    );
    await setup();

    expect(find('newsletter-invite-landing-card')?.textContent).toContain(heading);
    expect(find(testId)).not.toBeNull();
    expect(find('newsletter-invite-landing-confirm')).toBeNull();
    expect(find('newsletter-invite-landing-add-email')?.querySelector('a')?.getAttribute('href')).toBe('/profile/emails');
    expect(find('newsletter-invite-landing-add-email')?.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');

    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(of(status()));
    await click('newsletter-invite-landing-recheck');

    expect(newsletterService.getNewsletterGroupJoinStatus).toHaveBeenCalledTimes(2);
    expect(find('newsletter-invite-landing-confirm')).not.toBeNull();
  });

  it('joins on confirm, shows progress then the added banner, and emits joined', async () => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(of(status()));
    const join = new Subject<NewsletterJoinResult>();
    newsletterService.joinNewsletterGroupByInvite.mockReturnValue(join);
    await setup();

    await click('newsletter-invite-landing-confirm');

    expect(newsletterService.joinNewsletterGroupByInvite).toHaveBeenCalledWith('group-uid');
    expect(find('newsletter-member-benefit-joining')?.textContent).toContain('the Acme Foundation newsletter');
    expect(joined).not.toHaveBeenCalled();

    join.next(ADDED);
    join.complete();
    await fixture.whenStable();

    expect(find('newsletter-member-benefit-added')).not.toBeNull();
    expect(find('newsletter-member-benefit-email')?.textContent).toBe('pat@acme-motors.example');
    expect(joined).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable failure when the join fails', async () => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(of(status()));
    newsletterService.joinNewsletterGroupByInvite.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await setup();

    await click('newsletter-invite-landing-confirm');
    expect(find('newsletter-member-benefit-failed')).not.toBeNull();
    expect(joined).not.toHaveBeenCalled();

    newsletterService.joinNewsletterGroupByInvite.mockReturnValueOnce(of(ADDED));
    await click('newsletter-member-benefit-retry');

    expect(newsletterService.joinNewsletterGroupByInvite).toHaveBeenCalledTimes(2);
    expect(find('newsletter-member-benefit-added')).not.toBeNull();
    expect(joined).toHaveBeenCalledTimes(1);
  });

  it('returns to the confirmation silently when impersonation blocks the join', async () => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(of(status()));
    newsletterService.joinNewsletterGroupByInvite.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY', error: 'Read only' } }))
    );
    await setup();

    await click('newsletter-invite-landing-confirm');

    expect(find('newsletter-member-benefit-failed')).toBeNull();
    expect(find('newsletter-invite-landing-confirm')).not.toBeNull();
    expect(joined).not.toHaveBeenCalled();
  });

  it('emits dismissed from Not now without joining', async () => {
    newsletterService.getNewsletterGroupJoinStatus.mockReturnValue(of(status()));
    await setup();

    await click('newsletter-invite-landing-dismiss');

    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(newsletterService.joinNewsletterGroupByInvite).not.toHaveBeenCalled();
  });
});
