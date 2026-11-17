// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MentorshipProgramSubmitter } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProgramMetaComponent } from './program-meta.component';

describe('ProgramMetaComponent', () => {
  let fixture: ComponentFixture<ProgramMetaComponent>;

  const render = (date: string | null, submitter: MentorshipProgramSubmitter | null): HTMLElement => {
    fixture = TestBed.createComponent(ProgramMetaComponent);
    fixture.componentRef.setInput('dateLabel', 'Submitted');
    fixture.componentRef.setInput('date', date);
    fixture.componentRef.setInput('submitter', submitter);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const text = (el: HTMLElement, testId: string): string | undefined => el.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [ProgramMetaComponent] });
  });

  it('shows the date under its label, read in UTC', () => {
    const el = render('2026-09-15T23:30:00Z', null);

    expect(text(el, 'mentorship-program-meta-date')).toContain('Submitted');
    expect(text(el, 'mentorship-program-meta-date')).toContain('Sep 15, 2026');
  });

  it('shows the program admin with initials and a mailto link', () => {
    const el = render('2026-09-15T10:00:00Z', { name: 'Jane Doe', email: 'jane.doe@example.org', avatarUrl: null });

    expect(text(el, 'mentorship-program-meta-admin')).toContain('Program admin');
    expect(text(el, 'mentorship-program-meta-admin-initials')).toBe('JD');
    expect(text(el, 'mentorship-program-meta-admin-name')).toBe('Jane Doe');
    const email = el.querySelector('[data-testid="mentorship-program-meta-admin-email"]');
    expect(email?.getAttribute('href')).toBe('mailto:jane.doe@example.org');
    expect(email?.textContent?.trim()).toBe('jane.doe@example.org');
  });

  it('shows the avatar image when the program admin has one', () => {
    const el = render(null, { name: 'Jane Doe', email: null, avatarUrl: 'https://avatars.example/jane.png' });

    expect(el.querySelector('[data-testid="mentorship-program-meta-admin-avatar"]')?.getAttribute('src')).toBe('https://avatars.example/jane.png');
    expect(el.querySelector('[data-testid="mentorship-program-meta-admin-initials"]')).toBeNull();
    expect(el.querySelector('[data-testid="mentorship-program-meta-admin-email"]')).toBeNull();
    expect(el.querySelector('[data-testid="mentorship-program-meta-date"]')).toBeNull();
  });

  it('falls back to the initials when the avatar image fails to load', () => {
    const el = render(null, { name: 'Jane Doe', email: null, avatarUrl: 'https://avatars.example/broken.png' });

    el.querySelector('[data-testid="mentorship-program-meta-admin-avatar"]')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="mentorship-program-meta-admin-avatar"]')).toBeNull();
    expect(text(el, 'mentorship-program-meta-admin-initials')).toBe('JD');
  });

  it('shows an address that could add recipients as text, not as a mailto link', () => {
    const el = render(null, { name: 'Jane Doe', email: 'jane.doe@example.org?cc=other@example.org', avatarUrl: null });

    expect(el.querySelector('[data-testid="mentorship-program-meta-admin-email"]')).toBeNull();
    expect(text(el, 'mentorship-program-meta-admin-email-text')).toBe('jane.doe@example.org?cc=other@example.org');
  });

  it('renders nothing when both the date and the program admin are unknown', () => {
    const el = render(null, null);

    expect(el.querySelector('[data-testid="mentorship-program-meta"]')).toBeNull();
  });
});
