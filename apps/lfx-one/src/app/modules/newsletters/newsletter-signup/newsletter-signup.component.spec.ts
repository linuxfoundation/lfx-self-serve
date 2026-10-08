// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import type { PublicNewsletterSignupInfo } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { installMatchMediaShim } from '@shared/testing/header-test-providers';
import { Observable, of, throwError } from 'rxjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NewsletterSignupComponent } from './newsletter-signup.component';

beforeAll(installMatchMediaShim);

const GROUP_UID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

function info(over: Partial<PublicNewsletterSignupInfo['project']> = {}, acceptingSignups = true): PublicNewsletterSignupInfo {
  return {
    project: { name: 'Acme Project', slug: 'acme', logo_url: 'https://cdn.example.org/acme.png', ...over },
    group: { uid: GROUP_UID, name: 'Acme News', description: 'Monthly project updates.' },
    accepting_signups: acceptingSignups,
  };
}

describe('NewsletterSignupComponent', () => {
  let fixture: ComponentFixture<NewsletterSignupComponent>;
  let subscribeToNewsletter: ReturnType<typeof vi.fn>;

  async function render(load: Observable<PublicNewsletterSignupInfo>, subscribeResult: Observable<unknown> = of({ status: 'subscribed' })): Promise<void> {
    subscribeToNewsletter = vi.fn(() => subscribeResult);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NewsletterSignupComponent],
      providers: [
        { provide: NewsletterService, useValue: { getPublicSignupInfo: () => load, subscribeToNewsletter } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ projectSlug: 'acme', groupUid: GROUP_UID })) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NewsletterSignupComponent);
    await fixture.whenStable();
  }

  function el(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function submit(email: string): Promise<void> {
    const input = fixture.nativeElement.querySelector('#newsletter-signup-email') as HTMLInputElement;
    input.value = email;
    input.dispatchEvent(new Event('input'));
    (el('newsletter-signup-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  it('renders the project logo, group name, instructions and subscribe form', async () => {
    await render(of(info()));

    expect(el('newsletter-signup-logo')?.getAttribute('src')).toBe('https://cdn.example.org/acme.png');
    expect(el('newsletter-signup-logo')?.getAttribute('alt')).toBe('Acme Project logo');
    expect(el('newsletter-signup-project-name')?.textContent?.trim()).toBe('Acme Project');
    expect(el('newsletter-signup-title')?.textContent?.trim()).toBe('Subscribe to Acme News');
    expect(el('newsletter-signup-description')?.textContent?.trim()).toBe('Monthly project updates.');
    expect(el('newsletter-signup-instructions')).not.toBeNull();
    expect(el('newsletter-signup-submit')).not.toBeNull();
  });

  it('falls back to project initials when there is no logo', async () => {
    await render(of(info({ logo_url: undefined })));

    expect(el('newsletter-signup-logo')).toBeNull();
    expect(el('newsletter-signup-initials')?.textContent?.trim()).toBe('AP');
  });

  it('shows the invalid-link state on a 404 without leaking any project details', async () => {
    await render(throwError(() => new HttpErrorResponse({ status: 404 })));

    expect(el('newsletter-signup-not-found')).not.toBeNull();
    expect(el('newsletter-signup-form')).toBeNull();
    expect(el('newsletter-signup-project-name')).toBeNull();
  });

  it('shows a load error (not the invalid-link state) on other failures', async () => {
    await render(throwError(() => new HttpErrorResponse({ status: 503 })));

    expect(el('newsletter-signup-load-error')).not.toBeNull();
    expect(el('newsletter-signup-not-found')).toBeNull();
  });

  it('rejects an invalid email inline without calling the API', async () => {
    await render(of(info()));
    await submit('not-an-email');

    expect(el('newsletter-signup-email-error')?.textContent).toContain('valid email');
    expect(subscribeToNewsletter).not.toHaveBeenCalled();
  });

  it('subscribes a normalized email and swaps to the success state with next steps', async () => {
    await render(of(info()));
    await submit('  Jane@Example.org ');

    expect(subscribeToNewsletter).toHaveBeenCalledWith('acme', GROUP_UID, 'jane@example.org');
    expect(el('newsletter-signup-success')).not.toBeNull();
    expect(el('newsletter-signup-success-email')?.textContent?.trim()).toBe('jane@example.org');
    expect(el('newsletter-signup-next-steps')).not.toBeNull();
    expect(el('newsletter-signup-form')).toBeNull();
  });

  it('returns to an empty form from "Subscribe another email"', async () => {
    await render(of(info()));
    await submit('jane@example.org');

    el('newsletter-signup-subscribe-another')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(el('newsletter-signup-success')).toBeNull();
    expect((fixture.nativeElement.querySelector('#newsletter-signup-email') as HTMLInputElement).value).toBe('');
  });

  it('shows a friendly rate-limit message on 429 and keeps the form', async () => {
    await render(
      of(info()),
      throwError(() => new HttpErrorResponse({ status: 429 }))
    );
    await submit('jane@example.org');

    expect(el('newsletter-signup-submit-error')?.textContent).toContain('Too many attempts');
    expect(el('newsletter-signup-form')).not.toBeNull();
  });

  it('shows a "not accepting signups" state instead of the form for groups that refuse email-only members', async () => {
    await render(of(info({}, false)));

    expect(el('newsletter-signup-unavailable')).not.toBeNull();
    expect(el('newsletter-signup-form')).toBeNull();
    expect(el('newsletter-signup-project-name')?.textContent?.trim()).toBe('Acme Project');
  });

  it('blames the email only for the BFF email validation error, not for other 400s', async () => {
    await render(
      of(info()),
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'VALIDATION_ERROR' } }))
    );
    await submit('jane@example.org');

    expect(el('newsletter-signup-email-error')).toBeNull();
    expect(el('newsletter-signup-submit-error')?.textContent).toContain('Please try again');
  });

  it('shows the email error for a BFF email validation 400', async () => {
    await render(
      of(info()),
      throwError(() => new HttpErrorResponse({ status: 400, error: { errors: [{ field: 'email' }] } }))
    );
    await submit('jane@example.org');

    expect(el('newsletter-signup-email-error')?.textContent).toContain('valid email');
  });

  it('explains a group that stopped accepting signups after the page loaded', async () => {
    await render(
      of(info()),
      throwError(() => new HttpErrorResponse({ status: 400, error: { errors: [{ field: 'group' }] } }))
    );
    await submit('jane@example.org');

    expect(el('newsletter-signup-submit-error')?.textContent).toContain('accepting signups');
  });

  it('shows a generic retry message on other submit failures', async () => {
    await render(
      of(info()),
      throwError(() => new HttpErrorResponse({ status: 502 }))
    );
    await submit('jane@example.org');

    expect(el('newsletter-signup-submit-error')?.textContent).toContain('Please try again');
  });
});
