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
import { EventsPastEventsComponent } from './components/events-past-events/events-past-events.component';
import { EventsRegistrationForecastComponent } from './components/events-registration-forecast/events-registration-forecast.component';
import { HealthMetricsEventsComponent } from './health-metrics-events.component';

/** Stands in for the forecast section, whose reads its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-events-registration-forecast', template: '<div data-testid="events-forecast-stub"></div>' })
class ForecastStubComponent {
  public readonly countsChange = output<string>();
  public readonly settled = output<void>();
  public readonly reading = output<void>();
  public readonly sectionPicked = output<string>();
}

/** Stands in for Past events, whose reads its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-events-past-events', template: '<div data-testid="events-past-stub"></div>' })
class PastStubComponent {
  public readonly countChange = output<number | null>();
  public readonly settled = output<void>();
  public readonly reading = output<void>();
  public readonly sectionPicked = output<string>();
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
        remove: { imports: [EventsRegistrationForecastComponent, EventsPastEventsComponent] },
        add: { imports: [ForecastStubComponent, PastStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsEventsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function sectionsReport(note: string, pastCount: number | null = null): Promise<void> {
    const forecast = fixture.debugElement.query(By.directive(ForecastStubComponent)).componentInstance as ForecastStubComponent;
    const pastStub = fixture.debugElement.query(By.directive(PastStubComponent)).componentInstance as PastStubComponent;
    forecast.countsChange.emit(note);
    forecast.settled.emit();
    pastStub.countChange.emit(pastCount);
    pastStub.settled.emit();
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

  it('renders the nine sections in order, with the forecast and past bodies and placeholders for the rest', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="events-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => `sec-evt-${section.key}`));
    rendered.forEach((element, index) => {
      const key = HEALTH_METRICS_EVENTS_SECTIONS[index].key;
      expect(element.textContent).toContain(HEALTH_METRICS_EVENTS_SECTIONS[index].heading);
      if (key === 'forecast') {
        expect(element.querySelector('[data-testid="events-forecast-stub"]')).not.toBeNull();
      } else if (key === 'past') {
        expect(element.querySelector('[data-testid="events-past-stub"]')).not.toBeNull();
      } else {
        expect(element.textContent).toContain('Awaiting data');
      }
    });
  });

  it('lists every section in the sub-nav, with no badge before a read and the Members note', async () => {
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
    await sectionsReport('2 will miss goal');

    expect(fixture.nativeElement.querySelector('[data-testid="events-sub-nav-forecast"]').textContent).toContain('2 will miss goal');
  });

  it('badges Past events with the count it reports', async () => {
    await setup();
    await sectionsReport('', 12);

    expect(fixture.nativeElement.querySelector('[data-testid="events-sub-nav-past"]').textContent).toContain('12');
    expect(fixture.nativeElement.querySelector('[data-testid="events-sub-nav-forecast"]').textContent).not.toMatch(/\d/);
  });

  it('scrolls to the section a deep link names', async () => {
    await setup('spon');
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    // The shell re-lands a held deep link once every data section has settled.
    scrollIntoView.mockClear();
    await sectionsReport('');

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('events-sub-nav-spon');
  });

  it('scrolls to Past events on every pick from the forecast, not only when the URL changes', async () => {
    await setup('past');
    await sectionsReport('');
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    const stub = fixture.debugElement.query(By.directive(ForecastStubComponent)).componentInstance as ForecastStubComponent;
    stub.sectionPicked.emit('past');
    stub.sectionPicked.emit('past');
    fixture.detectChanges();

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('events-sub-nav-past');
  });
});
