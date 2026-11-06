// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NewsletterFoundationSummary } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterGuestModalComponent } from './newsletter-guest-modal.component';

const foundation: NewsletterFoundationSummary = { uid: 'f-1', slug: 'acme', name: 'Acme Foundation', logo_url: null };

describe('NewsletterGuestModalComponent', () => {
  let fixture: ComponentFixture<NewsletterGuestModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NewsletterGuestModalComponent] }).compileComponents();
    fixture = TestBed.createComponent(NewsletterGuestModalComponent);
    fixture.componentRef.setInput('foundation', foundation);
    fixture.componentRef.setInput('membershipName', 'Acme Foundation');
  });

  function el(): HTMLElement {
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function text(testId: string): string {
    return el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
  }

  function submit(): void {
    el()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('names the member company in invite mode, with a generic fallback', () => {
    fixture.componentRef.setInput('mode', 'invite');
    fixture.componentRef.setInput('companyName', 'Acme Motors');
    expect(text('newsletter-guest-modal-description')).toBe(
      'Acme Motors is a member of Acme Foundation, so as an employee of Acme Motors you get its newsletter as a member benefit, sent right to your inbox.'
    );

    fixture.componentRef.setInput('companyName', '');
    expect(text('newsletter-guest-modal-description')).toBe(
      'Your company is a member of Acme Foundation, so you get its newsletter as a member benefit, sent right to your inbox.'
    );
  });

  it('asks for a work email in shared mode', () => {
    fixture.componentRef.setInput('mode', 'shared');
    expect(text('newsletter-guest-modal-description')).toBe(
      'This newsletter is a member benefit for employees of Acme Foundation member companies. Enter your work email to read it.'
    );
    expect(text('newsletter-guest-modal-heading')).toBe('Be the first to hear about new stories from Acme Foundation');
  });

  it('shows the logo when there is one, else the first letter', () => {
    expect(text('newsletter-guest-modal-monogram')).toBe('A');

    fixture.componentRef.setInput('foundation', { ...foundation, logo_url: 'https://logos.example/acme.png' });
    expect(el().querySelector('[data-testid="newsletter-guest-modal-logo"]')?.getAttribute('src')).toBe('https://logos.example/acme.png');
  });

  it('emits the trimmed email on Continue', () => {
    const emitted = vi.fn();
    fixture.componentInstance.continued.subscribe(emitted);
    fixture.componentRef.setInput('email', '  jane@acme-motors.example ');

    submit();

    expect(emitted).toHaveBeenCalledWith('jane@acme-motors.example');
  });

  it('does not continue with a blank email, while loading, or when blocked', () => {
    const emitted = vi.fn();
    fixture.componentInstance.continued.subscribe(emitted);

    fixture.componentRef.setInput('email', '   ');
    submit();

    fixture.componentRef.setInput('email', 'jane@acme-motors.example');
    fixture.componentRef.setInput('loading', true);
    submit();

    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('blocked', true);
    submit();

    expect(emitted).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="newsletter-guest-modal-continue"]')).toBeNull();
    expect(el().querySelector('[data-testid="newsletter-guest-modal-sign-in"]')).not.toBeNull();
  });
});
