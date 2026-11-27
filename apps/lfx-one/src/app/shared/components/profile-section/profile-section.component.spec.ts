// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ProfileSectionEmptyComponent } from './profile-section-empty.component';
import { ProfileSectionHintComponent } from './profile-section-hint.component';
import { ProfileSectionComponent } from './profile-section.component';

// The host template is set in the TestBed below: inline templates are capped at three lines.
const HOST_TEMPLATE = `
    <lfx-profile-section heading="Recognitions" description="Awards you've earned." testId="profile-recognitions">
      <lfx-profile-section-hint profileSectionActions label="Missing a badge?" tip="Badges come from Credly." />
      <lfx-profile-section-empty icon="fa-light fa-award" heading="No badges yet" description="Badges are issued through Credly." />
    </lfx-profile-section>
    <lfx-profile-section heading="Event speaking" testId="profile-speaking" />
`;

@Component({
  selector: 'lfx-test-host',
  template: '',
})
class TestHostComponent {}

describe('profile section building blocks', () => {
  const render = (): HTMLElement => {
    const fixture = TestBed.configureTestingModule({ imports: [TestHostComponent] })
      .overrideComponent(TestHostComponent, {
        set: { imports: [ProfileSectionComponent, ProfileSectionHintComponent, ProfileSectionEmptyComponent], template: HOST_TEMPLATE },
      })
      .createComponent(TestHostComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const query = (root: HTMLElement, testId: string) => root.querySelector(`[data-testid="${testId}"]`);

  it('names the section by its heading and shows the description', () => {
    const root = render();
    const section = query(root, 'profile-recognitions')!;

    expect(section.tagName).toBe('SECTION');
    expect(section.getAttribute('aria-labelledby')).toBe(query(root, 'profile-recognitions-title')?.id);
    expect(query(root, 'profile-recognitions-title')?.textContent?.trim()).toBe('Recognitions');
    expect(query(root, 'profile-recognitions-description')?.textContent?.trim()).toBe("Awards you've earned.");
  });

  it('leaves the description out when there is none', () => {
    expect(query(render(), 'profile-speaking-description')).toBeNull();
  });

  it('puts the hint beside the heading as a focusable label', () => {
    const hint = query(render(), 'profile-section-hint') as HTMLElement;

    expect(hint.textContent?.trim()).toBe('Missing a badge?');
    expect(hint.getAttribute('tabindex')).toBe('0');
  });

  it('shows the small empty state on a card', () => {
    const empty = query(render(), 'profile-section-empty') as HTMLElement;

    expect(empty.textContent).toContain('No badges yet');
    expect(empty.textContent).toContain('Badges are issued through Credly.');
  });
});
