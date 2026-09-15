// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MentorshipMentorProfileDetails } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorProfileDetailsComponent } from './mentor-profile-details.component';

describe('MentorProfileDetailsComponent', () => {
  const baseProfile: MentorshipMentorProfileDetails = {
    aboutMe: 'Maintainer working on telemetry.',
    skills: ['Python', 'Go'],
    resumeFileName: 'dana-okafor-resume.pdf',
    resumeUrl: 'https://example.com/resume.pdf',
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
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-resume"]')).not.toBeNull();
  });

  it('shows the introduction when the mentor has authored one', () => {
    setup();

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-about-text"]')?.textContent?.trim()).toBe(
      'Maintainer working on telemetry.'
    );
  });

  it('falls back to an empty label when the introduction is blank', () => {
    setup({ ...baseProfile, aboutMe: '   ' });

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-about-text"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-about-empty"]')).not.toBeNull();
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

  it('renders the resume as a link when a URL is provided, so the file downloads on click', () => {
    setup();

    const link = element().querySelector<HTMLAnchorElement>('[data-testid="mentorship-mentor-profile-details-resume-link"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com/resume.pdf');
    // Opening a resume in a new tab must not carry the LFX session cookie / referrer.
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.textContent).toContain('dana-okafor-resume.pdf');
  });

  it('shows the file name without a link when no URL is available', () => {
    setup({ ...baseProfile, resumeUrl: '' });

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-resume-link"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-resume-name"]')?.textContent).toContain('dana-okafor-resume.pdf');
  });

  it('renders the resume empty label when the mentor has not uploaded one', () => {
    setup({ ...baseProfile, resumeFileName: undefined, resumeUrl: undefined });

    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-resume-link"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-resume-name"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-profile-details-resume-empty"]')).not.toBeNull();
  });

  it('emits editClick when the Edit Mentor Profile button is pressed', () => {
    setup();

    const handler = vi.fn();
    fixture.componentInstance.editClick.subscribe(handler);

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-profile-details-edit"] button')?.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
