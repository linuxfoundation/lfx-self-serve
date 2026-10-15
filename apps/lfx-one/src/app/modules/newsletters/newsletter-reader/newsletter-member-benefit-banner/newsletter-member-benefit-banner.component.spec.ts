// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NewsletterJoinState } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterMemberBenefitBannerComponent } from './newsletter-member-benefit-banner.component';

describe('NewsletterMemberBenefitBannerComponent', () => {
  let fixture: ComponentFixture<NewsletterMemberBenefitBannerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewsletterMemberBenefitBannerComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(NewsletterMemberBenefitBannerComponent);
    fixture.componentRef.setInput('email', 'jane@acme-motors.example');
    fixture.componentRef.setInput('companyName', 'Acme Motors');
    fixture.componentRef.setInput('groupName', 'LF Weekly');
  });

  function render(state: NewsletterJoinState): HTMLElement {
    fixture.componentRef.setInput('joinState', state);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders nothing while idle', () => {
    expect(render({ status: 'idle' }).textContent?.trim()).toBe('');
  });

  it('shows progress while joining', () => {
    const el = render({ status: 'joining' });

    expect(el.querySelector('[data-testid="newsletter-member-benefit-joining"]')?.textContent).toContain('Adding you to LF Weekly');
  });

  it('confirms the add with the server-confirmed email and company', () => {
    const el = render({
      status: 'added',
      result: { status: 'added', email: 'jane@eng.acme-motors.example', committee_name: 'LF Weekly', company_name: 'Acme Motors' },
    });

    expect(el.querySelector('[data-testid="newsletter-member-benefit-added"]')?.textContent).toContain('Acme Motors is a Linux Foundation member');
    expect(el.querySelector('[data-testid="newsletter-member-benefit-email"]')?.textContent).toBe('jane@eng.acme-motors.example');
  });

  it('falls back to the inputs when the result carries no names', () => {
    const el = render({ status: 'added', result: { status: 'added', email: '', committee_name: '', company_name: '' } });

    expect(el.querySelector('[data-testid="newsletter-member-benefit-email"]')?.textContent).toBe('jane@acme-motors.example');
  });

  it('does not claim an address for an existing membership the server did not name', () => {
    const el = render({ status: 'already_member', result: { status: 'already_member', email: '', committee_name: '', company_name: '' } });

    const banner = el.querySelector('[data-testid="newsletter-member-benefit-already"]');
    expect(banner?.textContent).toContain("You're already on the list for this newsletter.");
    expect(banner?.textContent).not.toContain('jane@acme-motors.example');
  });

  it('emits retry from the failed state', () => {
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);
    const el = render({ status: 'failed' });

    (el.querySelector('[data-testid="newsletter-member-benefit-retry"]') as HTMLButtonElement).click();

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
