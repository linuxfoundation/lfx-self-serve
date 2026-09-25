// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_EVENTS_SECTIONS } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { EventsRegistrationForecastComponent } from './components/events-registration-forecast/events-registration-forecast.component';
import { HealthMetricsEventsComponent } from './health-metrics-events.component';

/** Stands in for the forecast section, whose reads its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-events-registration-forecast', template: '<div data-testid="events-forecast-stub"></div>' })
class ForecastStubComponent {
  public readonly countsChange = output<string>();
  public readonly settled = output<void>();
  public readonly reading = output<void>();
}

// Covers only what Events wires into the shell: its copy, section bodies and sub-nav. The scroll-spy
// and deep-link behaviour is the shell's own spec.
describe('HealthMetricsEventsComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsEventsComponent>;

  async function setup(initialFragment: string | null = null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsEventsComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { fragment: new BehaviorSubject<string | null>(initialFragment).asObservable() } },
      ],
    })
      .overrideComponent(HealthMetricsEventsComponent, {
        remove: { imports: [EventsRegistrationForecastComponent] },
        add: { imports: [ForecastStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsEventsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function forecastReports(note: string): Promise<void> {
    const stub = fixture.debugElement.query(By.directive(ForecastStubComponent)).componentInstance as ForecastStubComponent;
    stub.countsChange.emit(note);
    stub.settled.emit();
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

  it('renders the nine sections in order, with the forecast body and placeholders for the rest', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="events-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => `sec-evt-${section.key}`));
    rendered.forEach((element, index) => {
      const key = HEALTH_METRICS_EVENTS_SECTIONS[index].key;
      expect(element.textContent).toContain(HEALTH_METRICS_EVENTS_SECTIONS[index].heading);
      if (key === 'forecast') {
        expect(element.querySelector('[data-testid="events-forecast-stub"]')).not.toBeNull();
      } else {
        expect(element.textContent).toContain('Awaiting data');
      }
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

  it('shows the note the forecast reports on its sub-nav item', async () => {
    await setup();
    await forecastReports('2 will miss goal');

    expect(fixture.nativeElement.querySelector('[data-testid="events-sub-nav-forecast"]').textContent).toContain('2 will miss goal');
  });

  it('scrolls to the section a deep link names', async () => {
    await setup('spon');
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    // The shell re-lands a held deep link once every data section has settled.
    scrollIntoView.mockClear();
    await forecastReports('');

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('events-sub-nav-spon');
  });
});
