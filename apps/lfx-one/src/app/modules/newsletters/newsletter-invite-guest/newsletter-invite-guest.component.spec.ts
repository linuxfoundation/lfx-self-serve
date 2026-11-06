// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '@app/shared/services/user.service';
import { NewsletterService } from '@services/newsletter.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterGuestModalComponent } from '../components/newsletter-guest-modal/newsletter-guest-modal.component';
import { NewsletterInviteGuestComponent } from './newsletter-invite-guest.component';

const foundation = { uid: 'f-1', slug: 'acme-foundation', name: 'Acme Foundation', logo_url: null };
const validInvite = {
  status: 'valid' as const,
  foundation,
  membership_name: 'Acme Foundation',
  committee_uid: 'c-news',
  email: 'jane@acme-motors.example',
  company_name: 'Acme Motors',
};
const issue = {
  foundation,
  email: 'jane@acme-motors.example',
  newsletter: { id: 'n-1', subject: 'October update', sent_at: '2026-10-01T00:00:00Z', body_html: '<p>Latest member news</p>' },
  confirmation_sent: false,
};

describe('NewsletterInviteGuestComponent', () => {
  let newsletterService: Record<string, ReturnType<typeof vi.fn>>;
  let router: { navigate: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<NewsletterInviteGuestComponent>;

  async function render(options: { fragment?: string | null; authenticated?: boolean } = {}): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NewsletterInviteGuestComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: NewsletterService, useValue: newsletterService },
        { provide: Router, useValue: router },
        { provide: UserService, useValue: { authenticated: signal(options.authenticated ?? false) } },
        { provide: ActivatedRoute, useValue: { snapshot: { fragment: options.fragment === undefined ? 'token=signed.token' : options.fragment } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NewsletterInviteGuestComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function modal(): NewsletterGuestModalComponent | undefined {
    return fixture.debugElement.query(By.directive(NewsletterGuestModalComponent))?.componentInstance;
  }

  beforeEach(() => {
    newsletterService = {
      inspectNewsletterGuestInvite: vi.fn().mockReturnValue(of(validInvite)),
      acceptNewsletterGuestInvite: vi.fn().mockReturnValue(of(issue)),
      getNewsletterGuestLatestIssue: vi.fn().mockReturnValue(of({ issue: null })),
    };
    router = { navigate: vi.fn().mockResolvedValue(true) };
  });

  it('shows the member-benefit modal with the invited address read-only', async () => {
    const el = await render();

    expect(newsletterService['inspectNewsletterGuestInvite']).toHaveBeenCalledWith('signed.token');
    expect(el.querySelector('[data-testid="newsletter-guest-modal-heading"]')?.textContent).toContain(
      'Be the first to hear about new stories from Acme Foundation'
    );
    expect(el.querySelector('[data-testid="newsletter-guest-modal-description"]')?.textContent).toContain(
      'Acme Motors is a member of Acme Foundation, so as an employee of Acme Motors you get its newsletter as a member benefit'
    );
    expect(modal()!.mode()).toBe('invite');
    expect(modal()!.email()).toBe('jane@acme-motors.example');
    expect(el.querySelector('[data-testid="newsletter-guest-modal-sign-in"]')?.getAttribute('href')).toBe(
      `/login?returnTo=${encodeURIComponent('/newsletters/my/acme-foundation?invite=c-news')}`
    );
    expect(el.querySelector('[data-testid="newsletter-guest-reader-placeholder"]')).not.toBeNull();
  });

  it('accepts on Continue, shows the latest issue, and drops the token from the URL', async () => {
    const el = await render();

    modal()!.continued.emit('jane@acme-motors.example');
    fixture.detectChanges();

    expect(newsletterService['acceptNewsletterGuestInvite']).toHaveBeenCalledWith('signed.token');
    expect(el.querySelector('[data-testid="newsletter-guest-modal"]')).toBeNull();
    expect(el.textContent).toContain('Latest member news');
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true }));
  });

  it('offers only Sign in for an expired link', async () => {
    newsletterService['inspectNewsletterGuestInvite'].mockReturnValue(of({ status: 'expired' }));
    const el = await render();

    expect(el.querySelector('[data-testid="newsletter-guest-modal-continue"]')).toBeNull();
    expect(modal()!.errorMessage()).toBe('This invite link has expired or is invalid.');
  });

  it('hands a signed-in invitee to the drill-down confirm card', async () => {
    await render({ authenticated: true });

    expect(router.navigate).toHaveBeenCalledWith(['/newsletters/my', 'acme-foundation'], { queryParams: { invite: 'c-news' }, replaceUrl: true });
  });

  it('reads through an open guest session when there is no token', async () => {
    newsletterService['getNewsletterGuestLatestIssue'].mockReturnValue(of({ issue }));
    const el = await render({ fragment: null });

    expect(newsletterService['inspectNewsletterGuestInvite']).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="newsletter-guest-modal"]')).toBeNull();
    expect(el.textContent).toContain('Latest member news');
  });
});
