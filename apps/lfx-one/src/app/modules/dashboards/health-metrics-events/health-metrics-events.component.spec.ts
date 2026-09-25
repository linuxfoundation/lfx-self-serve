// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_EVENTS_SECTIONS } from '@lfx-one/shared/constants';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { HealthMetricsEventsComponent } from './health-metrics-events.component';

// Covers only what Events wires into the shell: its copy, placeholders and sub-nav. The scroll-spy
// and deep-link behaviour is the shell's own spec.
describe('HealthMetricsEventsComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsEventsComponent>;

  async function setup(initialFragment: string | null = null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsEventsComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: ActivatedRoute, useValue: { fragment: new BehaviorSubject<string | null>(initialFragment).asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsEventsComponent);
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

  it('renders the nine sections in order, each anchored with its design copy and a placeholder', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="events-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => `sec-evt-${section.key}`));
    rendered.forEach((element, index) => {
      expect(element.textContent).toContain(HEALTH_METRICS_EVENTS_SECTIONS[index].heading);
      expect(element.textContent).toContain('Awaiting data');
    });
  });

  it('lists every section in the sub-nav, with no badge and the Members note', async () => {
    await setup();
    const nav = fixture.nativeElement.querySelector('[data-testid="events-sub-nav"]');

    for (const section of HEALTH_METRICS_EVENTS_SECTIONS) {
      expect(fixture.nativeElement.querySelector(`[data-testid="events-sub-nav-${section.key}"]`).textContent).toContain(section.label);
    }
    expect(nav.textContent).not.toMatch(/\d/);
    expect(nav.textContent).toContain('also appears in Members');
  });

  it('scrolls to the section a deep link names', async () => {
    await setup('spon');

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('events-sub-nav-spon');
  });
});
