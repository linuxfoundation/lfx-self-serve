// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MENTORSHIP_RICH_TEXT_RAW_MAX } from '@lfx-one/shared/constants';
import { MentorshipMentorProfileDetails } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorProfileDetailsComponent } from './mentor-profile-details.component';

describe('MentorProfileDetailsComponent', () => {
  const baseProfile: MentorshipMentorProfileDetails = {
    aboutMe: 'Maintainer working on telemetry.',
    skills: ['Python', 'Go'],
  };

  let fixture: ComponentFixture<MentorProfileDetailsComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const setup = (profile: MentorshipMentorProfileDetails = baseProfile): void => {
    fixture = TestBed.createComponent(MentorProfileDetailsComponent);
    fixture.componentRef.setInput('profile', profile);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProfileDetailsComponent],
      providers: [provideNoopAnimations(), provideRouter([])],
    });
  });

  it('renders the section title, edit button, and every label', () => {
    setup();

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-title"]')?.textContent?.trim()).toBe('Mentor Profile');
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-edit"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-about"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-skills"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-resume"]')).toBeNull();
  });

  it('shows the introduction when the mentor has authored one', () => {
    setup();

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-about-text"]')?.textContent?.trim()).toBe(
      'Maintainer working on telemetry.'
    );
  });

  it('renders rich-editor HTML through [innerHTML] rather than displaying tags literally', () => {
    // `lfx-rich-editor` on the register form produces `<p>…</p>` — the naive
    // `{{ aboutMe() }}` binding would show the tags as text. `[innerHTML]` + the
    // Angular sanitiser is what unblocks the real upstream payload.
    setup({ ...baseProfile, aboutMe: '<p>Maintainer working on <strong>telemetry</strong>.</p>' });

    const rendered = element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-profile-details-about-text"]');
    expect(rendered).not.toBeNull();
    // Sanitised HTML lands as real elements, not escaped tags.
    expect(rendered?.querySelector('strong')?.textContent).toBe('telemetry');
    // And the tag characters themselves must not survive as visible glyphs.
    expect(rendered?.textContent).not.toContain('<p>');
    expect(rendered?.textContent).not.toContain('<strong>');
  });

  it.each([
    ['   ', 'whitespace-only string'],
    ['<p></p>', 'empty editor paragraph'],
    ['<p><br></p>', 'editor line-break stub'],
    ['<p>   </p>', 'whitespace inside a paragraph'],
  ])('treats %s as empty and falls back to the empty label (%s)', (blankValue) => {
    // Quill (behind `lfx-rich-editor`) stores empty answers as `<p></p>` — a bare
    // `.trim()` sees a populated string and would render the tag with no visible
    // content. `stripHtml` collapses every "editor-empty" shape into ''.
    setup({ ...baseProfile, aboutMe: blankValue });

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-about-text"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-about-empty"]')).not.toBeNull();
  });

  it('treats a stored aboutMe over the raw cap as non-empty without running the quadratic strip (lfx-self-serve-ops#37)', () => {
    // `aboutMe` comes back from the API, so it can exceed what the register form allows. Stripping
    // this nested-bracket payload directly would take seconds and trip the test timeout; the raw-cap
    // check skips it.
    const hostile = `${'<'.repeat(100_000)}${'>'.repeat(100_000)}`;
    expect(hostile.length).toBeGreaterThan(MENTORSHIP_RICH_TEXT_RAW_MAX);

    setup({ ...baseProfile, aboutMe: hostile });

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-about-empty"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-about-text"]')).not.toBeNull();
  });

  it('renders one chip per skill, in the order they arrive', () => {
    setup();

    const chips = element().querySelectorAll('[data-testid="mentorship-mentor-profile-details-skills-list"] > span');
    expect([...chips].map((chip) => chip.textContent?.trim())).toEqual(['Python', 'Go']);
  });

  it('shows the empty-skills label when the mentor has none', () => {
    setup({ ...baseProfile, skills: [] });

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-skills-list"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-skills-empty"]')).not.toBeNull();
  });

  it('emits editClick when the Edit Mentor Profile button is pressed', () => {
    setup();

    const handler = vi.fn();
    fixture.componentInstance.editClick.subscribe(handler);

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-profile-details-edit"] button')?.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
