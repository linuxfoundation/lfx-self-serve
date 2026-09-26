// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED, HEALTH_METRICS_EVENTS_SECTIONS } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { EventsAtAGlanceComponent } from './components/events-at-a-glance/events-at-a-glance.component';
import { EventsPastEventsComponent } from './components/events-past-events/events-past-events.component';
import { EventsRegistrationForecastComponent } from './components/events-registration-forecast/events-registration-forecast.component';
import { HealthMetricsEventsComponent } from './health-metrics-events.component';

import type { HealthMetricsEventsAtAGlance, HealthMetricsEventsAtAGlanceStatus } from '@lfx-one/shared/interfaces';

const GLANCE: HealthMetricsEventsAtAGlance = { periods: [], upcomingEvents: 4, hasEvents: true };

/** Stands in for the at-a-glance section, whose projection its own spec covers; the test reads its inputs. */
@Component({ selector: 'lfx-events-at-a-glance', template: '<div data-testid="events-kpi-stub"></div>' })
class AtAGlanceStubComponent {
  public readonly glance = input.required<HealthMetricsEventsAtAGlance>();
  public readonly status = input.required<HealthMetricsEventsAtAGlanceStatus>();
  public readonly settled = output<void>();
  public readonly reading = output<void>();
}

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
  let getEventsAtAGlance: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;

  async function setup(
    initialFragment: string | null = null,
    glance: HealthMetricsEventsAtAGlance | Error | Observable<never> = GLANCE,
    initialSlug: string | null = 'acme'
  ): Promise<void> {
    getEventsAtAGlance = vi.fn().mockReturnValue(read(glance));
    selectedFoundation = signal<{ slug: string } | null>(initialSlug === null ? null : { slug: initialSlug });
    await TestBed.configureTestingModule({
      imports: [HealthMetricsEventsComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getEventsAtAGlance } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { fragment: new BehaviorSubject<string | null>(initialFragment).asObservable() } },
      ],
    })
      .overrideComponent(HealthMetricsEventsComponent, {
        remove: { imports: [EventsAtAGlanceComponent, EventsRegistrationForecastComponent, EventsPastEventsComponent] },
        add: { imports: [AtAGlanceStubComponent, ForecastStubComponent, PastStubComponent] },
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
    atAGlanceStub().settled.emit();
    forecast.countsChange.emit(note);
    forecast.settled.emit();
    pastStub.countChange.emit(pastCount);
    pastStub.settled.emit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function read(glance: HealthMetricsEventsAtAGlance | Error | Observable<never>): Observable<HealthMetricsEventsAtAGlance> {
    if (glance instanceof Observable) return glance;

    return glance instanceof Error ? throwError(() => glance) : of(glance);
  }

  function atAGlanceStub(): AtAGlanceStubComponent {
    return fixture.debugElement.query(By.directive(AtAGlanceStubComponent)).componentInstance as AtAGlanceStubComponent;
  }

  beforeEach(() => {
    // Not implemented in jsdom, and the deep-link path calls it on a real section element.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('renders the nine sections in order, with the kpi, forecast and past bodies and placeholders for the rest', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="events-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_EVENTS_SECTIONS.map((section) => `sec-evt-${section.key}`));
    rendered.forEach((element, index) => {
      const key = HEALTH_METRICS_EVENTS_SECTIONS[index].key;
      expect(element.textContent).toContain(HEALTH_METRICS_EVENTS_SECTIONS[index].heading);
      if (key === 'kpi') {
        expect(element.querySelector('[data-testid="events-kpi-stub"]')).not.toBeNull();
      } else if (key === 'forecast') {
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

  it('reads the foundation at a glance once and hands the result to the section', async () => {
    await setup();

    expect(getEventsAtAGlance).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(atAGlanceStub().glance()).toEqual(GLANCE);
    expect(atAGlanceStub().status()).toBe('ready');
  });

  it('keeps the tab rendering when the read fails, with only the section marked failed', async () => {
    await setup(null, new Error('warehouse down'));

    expect(atAGlanceStub().status()).toBe('failed');
    expect(fixture.nativeElement.querySelector('[data-testid="events-forecast-stub"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="events-empty"]')).toBeNull();
  });

  it('swaps the whole shell for one empty state when the foundation has no events', async () => {
    await setup(null, { ...GLANCE, upcomingEvents: 0, hasEvents: false });
    const empty = fixture.nativeElement.querySelector('[data-testid="events-empty"]');

    expect(empty.textContent).toContain('No events yet');
    expect(fixture.nativeElement.querySelector('[data-testid="events-sub-nav"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid^="events-section-"]')).toBeNull();
  });

  it("drops a landed empty state back to loading on a foundation switch, never showing the next one's as empty", async () => {
    await setup(null, { ...GLANCE, upcomingEvents: 0, hasEvents: false });
    const next = new Subject<HealthMetricsEventsAtAGlance>();
    getEventsAtAGlance.mockReturnValue(next.asObservable());

    selectedFoundation.set({ slug: 'globex' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEventsAtAGlance).toHaveBeenLastCalledWith({ foundationSlug: 'globex' });
    expect(fixture.nativeElement.querySelector('[data-testid="events-empty"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="events-sub-nav"]')).not.toBeNull();
    expect(atAGlanceStub().status()).toBe('loading');

    next.next(GLANCE);
    fixture.detectChanges();

    expect(atAGlanceStub().status()).toBe('ready');
    expect(atAGlanceStub().glance()).toEqual(GLANCE);
  });

  it('settles the section when a loaded foundation is cleared, so the shell stops waiting on it', async () => {
    await setup();

    selectedFoundation.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getEventsAtAGlance).toHaveBeenCalledTimes(1);
    expect(atAGlanceStub().status()).toBe('ready');
    expect(atAGlanceStub().glance()).toEqual(HEALTH_METRICS_EVENTS_AT_A_GLANCE_UNMEASURED);
    expect(fixture.nativeElement.querySelector('[data-testid="events-empty"]')).toBeNull();
  });

  it('holds the section at loading while no foundation has resolved yet', async () => {
    await setup(null, GLANCE, null);

    expect(getEventsAtAGlance).not.toHaveBeenCalled();
    expect(atAGlanceStub().status()).toBe('loading');
  });

  it('renders the shell straight away while the read is still in flight', async () => {
    await setup(null, NEVER);

    expect(atAGlanceStub().status()).toBe('loading');
    expect(fixture.nativeElement.querySelector('[data-testid="events-sub-nav"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="events-empty"]')).toBeNull();
  });
});
