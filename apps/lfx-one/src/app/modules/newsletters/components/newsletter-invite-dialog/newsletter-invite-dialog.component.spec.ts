// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MyNewsletterFoundation, NewsletterInviteResult } from '@lfx-one/shared/interfaces';
import { NewsletterService } from '@services/newsletter.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterInviteDialogComponent } from './newsletter-invite-dialog.component';

const FOUNDATION: MyNewsletterFoundation = {
  uid: 'foundation-uid',
  slug: 'acme-foundation',
  name: 'Acme Foundation',
  logo_url: null,
  received_count: 2,
  last_sent_at: null,
  newsletter_group: { uid: 'group-uid', name: 'Acme Foundation Newsletter' },
  can_invite: true,
  membership_name: 'Agentic AI Foundation (AAIF)',
};

describe('NewsletterInviteDialogComponent', () => {
  let fixture: ComponentFixture<NewsletterInviteDialogComponent>;
  const newsletterService = { sendNewsletterInvite: vi.fn() };
  const messages = { add: vi.fn() };
  const ref = { close: vi.fn() };
  const find = (id: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  const emailInput = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-test="newsletter-invite-email"]')!;
  const sendButton = () => find('newsletter-invite-send')!.querySelector('button')!;
  const type = async (value: string) => {
    emailInput().value = value;
    emailInput().dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const submit = async () => {
    find('newsletter-invite-dialog')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
  };
  const sent = (email: string): NewsletterInviteResult => ({ email, foundation_name: 'Acme Foundation' });

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [NewsletterInviteDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: NewsletterService, useValue: newsletterService },
        { provide: MessageService, useValue: messages },
        { provide: DynamicDialogRef, useValue: ref },
        { provide: DynamicDialogConfig, useValue: { data: { foundation: FOUNDATION } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NewsletterInviteDialogComponent);
    await fixture.whenStable();
  });

  it('renders the foundation and keeps Send disabled until a valid email is entered', async () => {
    expect(find('newsletter-invite-dialog')?.textContent).toContain('Acme Foundation newsletter');
    // The membership the invitee's company needs is the foundation's own, named in the subtitle and hint.
    expect(find('newsletter-invite-dialog')?.textContent).toContain('Member benefit of Agentic AI Foundation (AAIF)');
    expect(find('newsletter-invite-hint')?.textContent).toContain('Must be a company email at a member organization of Agentic AI Foundation (AAIF).');
    expect(sendButton().disabled).toBe(true);

    await type('not-an-email');
    expect(sendButton().disabled).toBe(true);

    await type('pat@acme-motors.example');
    expect(sendButton().disabled).toBe(false);
  });

  it('flags a personal mailbox inline and refuses to send it', async () => {
    await type('pat@gmail.example');

    expect(find('newsletter-invite-personal')?.textContent).toContain('a benefit for member companies of Agentic AI Foundation (AAIF)');
    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(sendButton().disabled).toBe(true);

    await submit();
    expect(newsletterService.sendNewsletterInvite).not.toHaveBeenCalled();
  });

  it('sends a normalized email, toasts, lists the invite and clears the field for the next one', async () => {
    newsletterService.sendNewsletterInvite.mockImplementation((_uid: string, email: string) => of(sent(email)));

    await type('  Pat@Acme-Motors.example ');
    await submit();

    expect(newsletterService.sendNewsletterInvite).toHaveBeenCalledWith('foundation-uid', 'pat@acme-motors.example');
    expect(messages.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Invite sent' }));
    expect(find('newsletter-invite-sent-list')?.textContent).toContain('pat@acme-motors.example');
    expect(emailInput().value).toBe('');
    expect(find('newsletter-invite-send')?.textContent).toContain('Send another invite');
    expect(find('newsletter-invite-close')?.textContent).toContain('Done');

    await type('sam@acme-motors.example');
    await submit();
    await type('pat@acme-motors.example');
    await submit();
    const listed = Array.from(find('newsletter-invite-sent-list')!.querySelectorAll('span.flex')).map((el) => el.textContent?.trim());
    // Newest first, without duplicating a re-sent address.
    expect(listed).toEqual(['pat@acme-motors.example', 'sam@acme-motors.example']);
  });

  it('disables Send while the request is in flight', async () => {
    const pending = new Subject<NewsletterInviteResult>();
    newsletterService.sendNewsletterInvite.mockReturnValue(pending);

    await type('pat@acme-motors.example');
    await submit();
    expect(sendButton().disabled).toBe(true);

    pending.next(sent('pat@acme-motors.example'));
    pending.complete();
    await fixture.whenStable();
    expect(find('newsletter-invite-sent-list')).not.toBeNull();
  });

  it('shows the server field error and clears it when the email changes', async () => {
    newsletterService.sendNewsletterInvite.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { error: 'Validation failed', errors: [{ field: 'email', message: "acme-motors.example isn't a Linux Foundation member company" }] },
          })
      )
    );

    await type('pat@acme-motors.example');
    await submit();

    expect(find('newsletter-invite-error')?.textContent).toContain("acme-motors.example isn't a Linux Foundation member company");
    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(find('newsletter-invite-sent-list')).toBeNull();
    expect(messages.add).not.toHaveBeenCalled();

    await type('pat@example.com');
    expect(find('newsletter-invite-error')).toBeNull();
    expect(sendButton().disabled).toBe(false);
  });

  it('falls back to the envelope message, then a generic one', async () => {
    newsletterService.sendNewsletterInvite.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 429, error: { error: 'Too many invites. Please try again later.' } }))
    );
    await type('pat@acme-motors.example');
    await submit();
    expect(find('newsletter-invite-error')?.textContent).toContain('Too many invites');

    newsletterService.sendNewsletterInvite.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502, error: null })));
    await type('sam@acme-motors.example');
    await submit();
    expect(find('newsletter-invite-error')?.textContent).toContain("We couldn't send the invite. Please try again.");
  });

  it('closes with the number of invites sent', async () => {
    newsletterService.sendNewsletterInvite.mockImplementation((_uid: string, email: string) => of(sent(email)));
    find('newsletter-invite-close')!.querySelector('button')!.click();
    expect(ref.close).toHaveBeenLastCalledWith(0);

    await type('pat@acme-motors.example');
    await submit();
    find('newsletter-invite-close')!.querySelector('button')!.click();
    expect(ref.close).toHaveBeenLastCalledWith(1);
  });
});
