// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MENTORSHIP_RICH_TEXT_RAW_MAX } from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileDetails } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeProfileDetailsComponent } from './mentee-profile-details.component';

describe('MenteeProfileDetailsComponent', () => {
  const baseProfile: MentorshipMenteeProfileDetails = {
    aboutMe: 'Student working on telemetry.',
    skillsHave: ['Python', 'Go'],
    skillsWant: ['Kubernetes', 'Observability'],
    additionalNotes: 'Comfortable working asynchronously.',
  };

  let fixture: ComponentFixture<MenteeProfileDetailsComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const setup = (profile: MentorshipMenteeProfileDetails = baseProfile): void => {
    fixture = TestBed.createComponent(MenteeProfileDetailsComponent);
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeProfileDetailsComponent],
      providers: [provideNoopAnimations(), provideRouter([])],
    });
  });

  it('renders the section title, edit button, and every label', () => {
    setup();

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-title"]')?.textContent?.trim()).toBe('Mentee Profile');
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-edit"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-about"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-skills"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-areas"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-notes"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume"]')).toBeNull();
  });

  it('shows the introduction when the mentee has authored one', () => {
    setup();

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-about-text"]')?.textContent?.trim()).toBe('Student working on telemetry.');
  });

  it('renders rich-editor HTML through [innerHTML] rather than displaying tags literally', () => {
    setup({ ...baseProfile, aboutMe: '<p>Student working on <strong>telemetry</strong>.</p>' });

    const rendered = element().querySelector<HTMLElement>('[data-testid="mentorship-mentee-profile-details-about-text"]');
    expect(rendered).not.toBeNull();
    expect(rendered?.querySelector('strong')?.textContent).toBe('telemetry');
    expect(rendered?.textContent).not.toContain('<p>');
    expect(rendered?.textContent).not.toContain('<strong>');
  });

  it('strips script payloads from aboutMe before binding [innerHTML]', () => {
    setup({ ...baseProfile, aboutMe: '<p>Safe intro</p><script>alert(1)</script>' });

    const rendered = element().querySelector<HTMLElement>('[data-testid="mentorship-mentee-profile-details-about-text"]');
    expect(rendered?.textContent).toContain('Safe intro');
    expect(rendered?.querySelector('script')).toBeNull();
    expect(rendered?.innerHTML).not.toContain('<script>');
  });

  it('strips event handlers and javascript: links from the stored HTML the profile drawer now saves as sent', () => {
    setup({ ...baseProfile, aboutMe: '<p>Safe intro</p><img src="x" onerror="alert(1)"><p><a href="javascript:alert(1)">link</a></p>' });

    const rendered = element().querySelector<HTMLElement>('[data-testid="mentorship-mentee-profile-details-about-text"]');
    expect(rendered?.textContent).toContain('Safe intro');
    expect(rendered?.innerHTML).not.toContain('onerror');
    // Angular neutralises an unsafe URL by prefixing it with `unsafe:`, so the link can no longer run script.
    expect(rendered?.querySelector('a')?.getAttribute('href')).not.toMatch(/^javascript:/i);
  });

  it.each([
    ['   ', 'whitespace-only string'],
    ['<p></p>', 'empty editor paragraph'],
    ['<p><br></p>', 'editor line-break stub'],
    ['<p>   </p>', 'whitespace inside a paragraph'],
  ])('treats %s as empty and falls back to the empty label (%s)', (blankValue) => {
    setup({ ...baseProfile, aboutMe: blankValue });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-about-text"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-about-empty"]')).not.toBeNull();
  });

  it('treats a stored aboutMe over the raw cap as non-empty without running the quadratic strip (lfx-self-serve-ops#37)', () => {
    // `aboutMe` comes back from the API, so it can exceed what the register form allows. Stripping
    // this nested-bracket payload directly would take seconds and trip the test timeout; the raw-cap
    // check skips it.
    const hostile = `${'<'.repeat(100_000)}${'>'.repeat(100_000)}`;
    expect(hostile.length).toBeGreaterThan(MENTORSHIP_RICH_TEXT_RAW_MAX);

    setup({ ...baseProfile, aboutMe: hostile });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-about-empty"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-about-text"]')).not.toBeNull();
  });

  it('renders one chip per skill, in the order they arrive', () => {
    setup();

    const chips = element().querySelectorAll('[data-testid="mentorship-mentee-profile-details-skills-list"] > span');
    expect([...chips].map((chip) => chip.textContent?.trim())).toEqual(['Python', 'Go']);
  });

  it('shows the empty-skills label when the mentee has none', () => {
    setup({ ...baseProfile, skillsHave: [] });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-skills-list"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-skills-empty"]')).not.toBeNull();
  });

  it('renders one chip per area to improve, in the order they arrive', () => {
    setup();

    const chips = element().querySelectorAll('[data-testid="mentorship-mentee-profile-details-areas-list"] > span');
    expect([...chips].map((chip) => chip.textContent?.trim())).toEqual(['Kubernetes', 'Observability']);
  });

  it('shows the empty-areas label when the mentee has none', () => {
    setup({ ...baseProfile, skillsWant: [] });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-areas-list"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-areas-empty"]')).not.toBeNull();
  });

  it('renders skill_set.comments as Additional Notes', () => {
    setup();

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-notes-text"]')?.textContent?.trim()).toBe(
      'Comfortable working asynchronously.'
    );
  });

  it('shows the empty-notes label when skill_set.comments is absent', () => {
    setup({ ...baseProfile, additionalNotes: undefined });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-notes-text"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-notes-empty"]')).not.toBeNull();
  });

  it('shows the stored country code by its name', () => {
    setup({ ...baseProfile, country: 'KE' });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-country-text"]')?.textContent?.trim()).toBe('Kenya');
  });

  it('shows a stored code outside the country list as stored', () => {
    setup({ ...baseProfile, country: 'XK' });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-country-text"]')?.textContent?.trim()).toBe('XK');
  });

  it('shows the empty-country label when no country is stored', () => {
    setup();

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-country-text"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-country-empty"]')).not.toBeNull();
  });

  it('emits editClick when the Edit Mentee Profile button is pressed', () => {
    setup();

    const handler = vi.fn();
    fixture.componentInstance.editClick.subscribe(handler);

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentee-profile-details-edit"] button')?.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
