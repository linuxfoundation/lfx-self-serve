// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { MyNewsletterFoundation, MyNewsletterInviter } from '@lfx-one/shared/interfaces';
import { Tooltip } from 'primeng/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterFoundationCardComponent } from './newsletter-foundation-card.component';

function foundation(overrides: Partial<MyNewsletterFoundation> = {}): MyNewsletterFoundation {
  return {
    uid: 'foundation-uid',
    slug: 'acme-foundation',
    name: 'acme Foundation',
    logo_url: null,
    received_count: 3,
    last_sent_at: '2026-08-13T10:00:00Z',
    newsletter_group: { uid: 'group-uid', name: 'Acme Foundation Newsletter' },
    can_invite: true,
    ...overrides,
  };
}

describe('NewsletterFoundationCardComponent', () => {
  let fixture: ComponentFixture<NewsletterFoundationCardComponent>;
  const find = (id: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);
  const inviteButton = () => find('newsletter-foundation-card-invite')!.querySelector('button')!;
  const tooltipOf = (id: string) => fixture.debugElement.query(By.css(`[data-testid="${id}"]`)).injector.get(Tooltip).content;
  const disabledReason = () => (fixture.componentInstance as unknown as { inviteDisabledReason: () => string }).inviteDisabledReason();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewsletterFoundationCardComponent],
      providers: [provideNoopAnimations(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(NewsletterFoundationCardComponent);
  });

  function render(card: MyNewsletterFoundation, inviter: MyNewsletterInviter = { eligible: true, company_name: 'Acme Motors' }): HTMLElement {
    fixture.componentRef.setInput('foundation', card);
    fixture.componentRef.setInput('inviter', inviter);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the foundation identity, received count, last-sent date, group and drill-down links', () => {
    render(foundation());

    expect(find('newsletter-foundation-card-name')?.textContent).toContain('acme Foundation');
    expect(find('newsletter-foundation-card-count')?.textContent).toContain('3 newsletters received');
    expect(find('newsletter-foundation-card')?.textContent).toContain('Last Aug 13, 2026');
    expect(find('newsletter-foundation-card')?.textContent).toContain('Delivered through Acme Foundation Newsletter');
    // Truncated text carries its full value in a tooltip.
    expect(tooltipOf('newsletter-foundation-card-name')).toBe('acme Foundation');
    expect(tooltipOf('newsletter-foundation-card-group')).toBe('Delivered through Acme Foundation Newsletter');
    expect(find('newsletter-foundation-card')?.getAttribute('aria-label')).toBe('acme Foundation newsletter');
    expect(find('newsletter-foundation-card-view-all')?.getAttribute('href')).toBe('/newsletters/my/acme-foundation');
    expect(find('newsletter-foundation-card-body')?.getAttribute('href')).toBe('/newsletters/my/acme-foundation');
  });

  it('uses the singular label and hides optional chips when absent', () => {
    render(foundation({ received_count: 1, last_sent_at: null, newsletter_group: null }));

    expect(find('newsletter-foundation-card-count')?.textContent).toContain('1 newsletter received');
    expect(find('newsletter-foundation-card')?.textContent).not.toContain('Last ');
    expect(find('newsletter-foundation-card')?.textContent).not.toContain('Delivered through');
  });

  it('emits the foundation when Invite is clicked and invites are allowed', () => {
    const card = foundation();
    const invite = vi.fn();
    fixture.componentInstance.invite.subscribe(invite);
    render(card);

    expect(inviteButton().disabled).toBe(false);
    expect(disabledReason()).toBe('');
    const wrapper = find('newsletter-foundation-card-invite-wrapper')!;
    expect(wrapper.getAttribute('role')).toBeNull();
    expect(wrapper.getAttribute('aria-label')).toBeNull();
    expect(wrapper.hasAttribute('tabindex')).toBe(false);
    expect(inviteButton().getAttribute('aria-label')).toBe('Invite a colleague to the acme Foundation newsletter');
    inviteButton().click();

    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite).toHaveBeenCalledWith(card);
  });

  it('disables Invite and never emits when the user cannot invite', () => {
    const invite = vi.fn();
    fixture.componentInstance.invite.subscribe(invite);
    render(foundation({ can_invite: false }));

    expect(inviteButton().disabled).toBe(true);
    inviteButton().click();
    expect(invite).not.toHaveBeenCalled();
  });

  it.each([
    [{ eligible: false, company_name: null, denied_reason: 'unavailable' } as MyNewsletterInviter, "Invites aren't available right now"],
    [{ eligible: false, company_name: null, denied_reason: 'not_member_company' } as MyNewsletterInviter, 'Linux Foundation member companies'],
    [{ eligible: true, company_name: 'Acme Motors' } as MyNewsletterInviter, "once you're on this foundation's newsletter list"],
  ])('explains why Invite is disabled (%o)', (inviter, reason) => {
    render(foundation({ can_invite: false }), inviter);

    expect(disabledReason()).toContain(reason);
    // The disabled button is wrapped in a focusable note so the reason stays reachable by keyboard and AT.
    const wrapper = find('newsletter-foundation-card-invite-wrapper')!;
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    expect(wrapper.getAttribute('role')).toBe('note');
    expect(wrapper.getAttribute('aria-label')).toBe(disabledReason());
  });
});
