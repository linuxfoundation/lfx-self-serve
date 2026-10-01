// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { HealthMetricsNonMembersComponent } from './health-metrics-non-members.component';

// Covers only what Non-Members wires into the shell: its copy, placeholders and sub-nav. The
// scroll-spy and deep-link behaviour is the shell's own spec.
describe('HealthMetricsNonMembersComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsNonMembersComponent>;

  async function setup(initialFragment: string | null = null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsNonMembersComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { fragment: new BehaviorSubject<string | null>(initialFragment).asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsNonMembersComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    // Not implemented in jsdom, and the deep-link path calls it on a real section element.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('renders the three sections in order, each anchored with its design copy and a placeholder', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="non-members-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => `sec-non-${section.key}`));
    rendered.forEach((element, index) => {
      expect(element.textContent).toContain(HEALTH_METRICS_NON_MEMBERS_SECTIONS[index].heading);
      expect(element.textContent).toContain('Awaiting data');
    });
  });

  it('lists every section in the sub-nav, with no badge and the Engagement note', async () => {
    await setup();
    const nav = fixture.nativeElement.querySelector('[data-testid="non-members-sub-nav"]');

    for (const section of HEALTH_METRICS_NON_MEMBERS_SECTIONS) {
      expect(fixture.nativeElement.querySelector(`[data-testid="non-members-sub-nav-${section.key}"]`).textContent).toContain(section.label);
    }
    expect(nav.textContent).not.toMatch(/\d/);
    expect(nav.textContent).toContain('Non-members attending meetings also appear in Engagement');
    expect(fixture.nativeElement.querySelector('[data-testid="non-members-sub-nav-cross-reference-link"]').getAttribute('href')).toBe(
      '/foundation/health-metrics/engagement#nonmem'
    );
  });

  it('says above the sections that the project selector does not narrow them', async () => {
    await setup();
    const note = fixture.nativeElement.querySelector('[data-testid="non-members-scope-note"]');

    expect(note.textContent).toContain('foundation-wide');
    expect(note.compareDocumentPosition(fixture.nativeElement.querySelector('[data-testid="health-metrics-non-members-page"]'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('scrolls to the section a deep link names', async () => {
    await setup('conversion');

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('non-members-sub-nav-conversion');
  });
});
