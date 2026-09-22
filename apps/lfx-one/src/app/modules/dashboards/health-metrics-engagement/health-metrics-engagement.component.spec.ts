// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_ENGAGEMENT_SECTIONS } from '@lfx-one/shared/constants';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { EngagementSubNavComponent } from './components/engagement-sub-nav/engagement-sub-nav.component';
import { HealthMetricsEngagementComponent } from './health-metrics-engagement.component';

import type { HealthMetricsEngagementGroupCounts } from '@lfx-one/shared/interfaces';

// Stands in for the real Group attendance section, matched by selector — this spec covers the shell,
// and the real one would drag in HttpClient and the analytics read.
@Component({ selector: 'lfx-engagement-group-attendance', template: '' })
class GroupAttendanceStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementGroupCounts>();
}

// Captures every observer the component builds so a test can fire entries at it directly; the real
// one never intersects in jsdom.
class FakeIntersectionObserver implements IntersectionObserver {
  public static instances: FakeIntersectionObserver[] = [];

  public readonly root = null;
  public readonly rootMargin: string;
  public readonly thresholds: readonly number[] = [0];
  public readonly observed: Element[] = [];
  public disconnected = false;

  public constructor(
    public readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.rootMargin = options?.rootMargin ?? '';
    FakeIntersectionObserver.instances.push(this);
  }

  public observe(target: Element): void {
    this.observed.push(target);
  }
  public unobserve(): void {
    /* no-op */
  }
  public disconnect(): void {
    this.disconnected = true;
  }
  public takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  public fire(target: Element, isIntersecting: boolean): void {
    this.callback([{ target, isIntersecting } as unknown as IntersectionObserverEntry], this);
  }
}

describe('HealthMetricsEngagementComponent', () => {
  let fixture: ComponentFixture<HealthMetricsEngagementComponent>;
  let chrome: HealthMetricsChromeService;
  let fragment: Subject<string | null>;

  function headingOf(key: string): Element {
    return fixture.nativeElement.querySelector(`#sec-eng-${key}-heading`);
  }

  /** The heading observer — the end sentinel's is always constructed second. */
  function spyObserver(): FakeIntersectionObserver {
    return FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 2];
  }

  function activeKey(): string | null {
    return fixture.nativeElement.querySelector('[aria-current="true"]')?.getAttribute('data-testid')?.replace('engagement-sub-nav-', '') ?? null;
  }

  beforeEach(async () => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    fragment = new Subject<string | null>();

    await TestBed.configureTestingModule({
      imports: [HealthMetricsEngagementComponent],
      providers: [HealthMetricsChromeService, { provide: ActivatedRoute, useValue: { fragment: fragment.asObservable() } }],
    })
      .overrideComponent(HealthMetricsEngagementComponent, { set: { imports: [EngagementSubNavComponent, GroupAttendanceStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsEngagementComponent);
    chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);
    fixture.detectChanges();
    // Flushes `afterNextRender`, which is where the scroll-spy is wired up.
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // The getElementById spies below would otherwise survive into the next TestBed render.
    vi.restoreAllMocks();
  });

  it('renders every section with a stable anchor id and its design copy', () => {
    for (const section of HEALTH_METRICS_ENGAGEMENT_SECTIONS) {
      const element = fixture.nativeElement.querySelector(`[data-testid="engagement-section-${section.key}"]`);

      expect(element).not.toBeNull();
      expect(element.getAttribute('id')).toBe(`sec-eng-${section.key}`);
      expect(element.textContent).toContain(section.heading);
    }
  });

  it('marks the caution footnote on the non-member section only', () => {
    const cautioned = HEALTH_METRICS_ENGAGEMENT_SECTIONS.filter((section) => section.footnoteCaution).map((section) => section.key);

    expect(cautioned).toEqual(['nonmem']);
    expect(fixture.nativeElement.querySelectorAll('.fa-triangle-exclamation')).toHaveLength(1);
  });

  it('starts with the first section active and no unresolved count badged', () => {
    expect(activeKey()).toBe(HEALTH_METRICS_ENGAGEMENT_SECTIONS[0].key);
    // Only Group attendance reports in PR 1, and it has not emitted yet, so no rail count is shown.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav"]').textContent).not.toMatch(/\d/);
  });

  it('badges Group attendance from the counts that section reports', () => {
    const child = fixture.debugElement.query(By.directive(GroupAttendanceStubComponent)).componentInstance as GroupAttendanceStubComponent;

    child.countsChange.emit({ groups: 34, dormantGroups: 3, lowAttendanceGroups: 5 });
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees"]');
    expect(item.textContent).toContain('34');
    expect(item.textContent).toContain('3 dormant · 5 below 50%');
  });

  it('bounds the scrolling pane to what is left of the viewport, so only it scrolls', () => {
    const panes = fixture.nativeElement.querySelector('[data-testid="health-metrics-engagement-page"]').lastElementChild as HTMLElement;

    expect(panes.className).toContain('lg:overflow-y-auto');
    expect(panes.style.getPropertyValue('--engagement-panes-height')).toBe(`${window.innerHeight - 24}px`);
  });

  it('observes each section heading below the measured sticky header', () => {
    const observer = spyObserver();

    expect(observer.observed).toHaveLength(HEALTH_METRICS_ENGAGEMENT_SECTIONS.length);
    expect(observer.rootMargin).toBe(`-${chrome.stickyTopPx()}px 0px -70% 0px`);
  });

  it('rebuilds the observer when the gate re-measures the sticky header', () => {
    const before = spyObserver();

    chrome.headerHeightPx.set(120);
    fixture.detectChanges();

    expect(before.disconnected).toBe(true);
    expect(spyObserver().rootMargin).toBe('-136px 0px -70% 0px');
  });

  it('lights exactly one item, the topmost intersecting heading', () => {
    const observer = spyObserver();

    observer.fire(headingOf('orgs'), true);
    observer.fire(headingOf('committees'), true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(activeKey()).toBe('committees');

    // Scrolling the earlier heading out hands the highlight to the next one down, not to nothing.
    observer.fire(headingOf('committees'), false);
    fixture.detectChanges();
    expect(activeKey()).toBe('orgs');
  });

  it('keeps the last active item when nothing is intersecting mid-scroll', () => {
    const observer = spyObserver();

    observer.fire(headingOf('reps'), true);
    fixture.detectChanges();
    observer.fire(headingOf('reps'), false);
    fixture.detectChanges();

    expect(activeKey()).toBe('reps');
  });

  it('follows a section fragment, and ignores one that is not a section', () => {
    const scrollIntoView = vi.fn();
    vi.spyOn(document, 'getElementById').mockReturnValue({ scrollIntoView } as unknown as HTMLElement);

    fragment.next('orgs');
    fixture.detectChanges();
    expect(activeKey()).toBe('orgs');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    // The allowlist is what keeps an arbitrary fragment from driving the rail.
    fragment.next('sec-eng-orgs');
    fragment.next('groups');
    fragment.next(null);
    fixture.detectChanges();
    expect(activeKey()).toBe('orgs');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('scrolls to the section the sub-nav emits', () => {
    const scrollIntoView = vi.fn();
    vi.spyOn(document, 'getElementById').mockReturnValue({ scrollIntoView } as unknown as HTMLElement);

    fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-nonmem"]').click();
    fixture.detectChanges();

    expect(activeKey()).toBe('nonmem');
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it('disconnects both observers on destroy', () => {
    const heading = spyObserver();
    const end = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];

    fixture.destroy();

    expect(heading.disconnected).toBe(true);
    expect(end.disconnected).toBe(true);
  });
});
