// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MentorshipMenteeProfileDetails } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeProfileDetailsComponent } from './mentee-profile-details.component';

describe('MenteeProfileDetailsComponent', () => {
  const baseProfile: MentorshipMenteeProfileDetails = {
    aboutMe: 'Student working on telemetry.',
    skillsHave: ['Python', 'Go'],
    skillsWant: ['Kubernetes', 'Observability'],
    additionalNotes: 'Comfortable working asynchronously.',
    resumeFileName: 'test-mentee-resume.pdf',
    resumeUrl: 'https://example.com/resume.pdf',
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
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume"]')).not.toBeNull();
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

  it('renders the resume as a link when a URL is provided, so the file downloads on click', () => {
    setup();

    const link = element().querySelector<HTMLAnchorElement>('[data-testid="mentorship-mentee-profile-details-resume-link"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com/resume.pdf');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.textContent).toContain('test-mentee-resume.pdf');
  });

  it('upgrades a scheme-less resume URL to the normalized https:// value before binding [href]', () => {
    setup({ ...baseProfile, resumeUrl: 'example.com/resume.pdf' });

    const link = element().querySelector<HTMLAnchorElement>('[data-testid="mentorship-mentee-profile-details-resume-link"]');
    expect(link?.getAttribute('href')).toBe('https://example.com/resume.pdf');
  });

  it('shows the file name without a link when no URL is available', () => {
    setup({ ...baseProfile, resumeUrl: '' });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume-link"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume-name"]')?.textContent).toContain('test-mentee-resume.pdf');
  });

  it('renders the resume link with a "View resume" fallback label when the URL is present but the filename is not', () => {
    setup({ ...baseProfile, resumeFileName: undefined });

    const link = element().querySelector<HTMLAnchorElement>('[data-testid="mentorship-mentee-profile-details-resume-link"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com/resume.pdf');
    expect(link?.textContent?.trim()).toBe('View resume');
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume-empty"]')).toBeNull();
  });

  it('allows a long resume filename to break rather than overflow the card', () => {
    setup({ ...baseProfile, resumeFileName: 'this-is-a-deliberately-extremely-long-single-token-filename-that-would-otherwise-overflow.pdf' });

    const label = element().querySelector<HTMLElement>('[data-testid="mentorship-mentee-profile-details-resume-link"] span:last-child');
    expect(label?.className).toContain('break-all');
    expect(label?.className).toContain('min-w-0');
  });

  it.each([
    ['javascript:alert(1)', 'javascript: URL'],
    ['data:text/html,<script>alert(1)</script>', 'data: URL'],
    ['vbscript:msgbox(1)', 'vbscript: URL'],
    ['#', 'fragment identifier'],
    ['/relative/path.pdf', 'relative path'],
    ['ftp://example.com/resume.pdf', 'non-http protocol'],
  ])('rejects %s (%s) and falls back to the non-link display', (untrustedUrl) => {
    setup({ ...baseProfile, resumeUrl: untrustedUrl });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume-link"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume-name"]')?.textContent).toContain('test-mentee-resume.pdf');
  });

  it('renders the resume empty label when the mentee has not uploaded one', () => {
    setup({ ...baseProfile, resumeFileName: undefined, resumeUrl: undefined });

    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume-link"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume-name"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentee-profile-details-resume-empty"]')).not.toBeNull();
  });

  it('emits editClick when the Edit Mentee Profile button is pressed', () => {
    setup();

    const handler = vi.fn();
    fixture.componentInstance.editClick.subscribe(handler);

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentee-profile-details-edit"] button')?.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
