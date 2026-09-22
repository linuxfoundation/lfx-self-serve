// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_ENGAGEMENT_PENDING_SECTION_TTL_MS, HEALTH_METRICS_ENGAGEMENT_SECTIONS } from '@lfx-one/shared/constants';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { EngagementSubNavComponent } from './components/engagement-sub-nav/engagement-sub-nav.component';
import { HealthMetricsEngagementComponent } from './health-metrics-engagement.component';

import type { HealthMetricsEngagementGroupCounts } from '@lfx-one/shared/interfaces';

// Stands in for the real Group attendance section, matched by selector — this spec covers the shell,
// and the real one would drag in HttpClient and the analytics read.
@Component({ selector: 'lfx-engagement-group-attendance', template: '' })
class GroupAttendanceStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementGroupCounts | null>();
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
  // Both are patched onto objects this suite does not own, so they are restored after every test.
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsEngagementComponent>;
  let chrome: HealthMetricsChromeService;
  let fragment: BehaviorSubject<string | null>;

  function headingOf(key: string): Element {
    return fixture.nativeElement.querySelector(`#sec-eng-${key}-heading`);
  }

  /** The heading observer — the end sentinel's is always constructed second. */
  function spyObserver(): FakeIntersectionObserver {
    return FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 2];
  }

  function endObserver(): FakeIntersectionObserver {
    return FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];
  }

  function stubChild(): GroupAttendanceStubComponent {
    return fixture.debugElement.query(By.directive(GroupAttendanceStubComponent)).componentInstance as GroupAttendanceStubComponent;
  }

  function activeKey(): string | null {
    return fixture.nativeElement.querySelector('[aria-current="true"]')?.getAttribute('data-testid')?.replace('engagement-sub-nav-', '') ?? null;
  }

  /**
   * `initialFragment` is seeded before creation because that is when the real `ActivatedRoute`
   * replays it — the deep-link path only exists on that first emission.
   */
  async function setup(initialFragment: string | null = null, platformId?: string): Promise<void> {
    fragment = new BehaviorSubject<string | null>(initialFragment);

    await TestBed.configureTestingModule({
      imports: [HealthMetricsEngagementComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: ActivatedRoute, useValue: { fragment: fragment.asObservable() } },
        ...(platformId ? [{ provide: PLATFORM_ID, useValue: platformId }] : []),
      ],
    })
      .overrideComponent(HealthMetricsEngagementComponent, { set: { imports: [EngagementSubNavComponent, GroupAttendanceStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsEngagementComponent);
    chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);
    fixture.detectChanges();
    // Flushes `afterNextRender`, which is where the scroll-spy is wired up.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    // jsdom reports a zero-height document, which would read as a page that needs no scrolling and
    // skip the end sentinel entirely.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: window.innerHeight * 3 });
    // Not implemented in jsdom, and the deep-link path calls it on a real section element.
    Element.prototype.scrollIntoView = vi.fn();

    await setup();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // The getElementById spies below would otherwise survive into the next TestBed render.
    vi.restoreAllMocks();
    delete (document.documentElement as unknown as { scrollHeight?: number }).scrollHeight;
    Element.prototype.scrollIntoView = originalScrollIntoView;
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

    child.countsChange.emit({ groups: 34, dormantGroups: 3 });
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees"]');
    expect(item.textContent).toContain('34');
    expect(item.textContent).toContain('3 dormant');
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

  it('scrolls to a fragment that was already in the URL before the sections existed', async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];

    await setup('reps');

    expect(activeKey()).toBe('reps');
    // The constructor subscription runs before the view exists, so this only happens if the deep
    // link is replayed after render.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('lights the last section when the end sentinel is reached', () => {
    const sentinel = fixture.nativeElement.querySelector('[data-testid="engagement-scroll-end-sentinel"]');
    const lastKey = HEALTH_METRICS_ENGAGEMENT_SECTIONS[HEALTH_METRICS_ENGAGEMENT_SECTIONS.length - 1].key;

    expect(endObserver().observed).toEqual([sentinel]);

    endObserver().fire(sentinel, true);
    fixture.detectChanges();

    // The last section is too short for its heading to reach the activation band, so the sentinel is
    // the only thing that can activate it.
    expect(activeKey()).toBe(lastKey);
  });

  it('skips the end sentinel when there is nothing to scroll', async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });

    await setup();

    // Otherwise the sentinel intersects from first paint and pins the rail to the last section.
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
  });

  it('re-runs the deep-link scroll only once the group table has painted', async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    await setup('reps');

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    stubChild().countsChange.emit({ groups: 34, dormantGroups: 3 });

    // Scrolling in the emitting turn would read the offsets from before the rows were laid out.
    expect(scrollIntoView).not.toHaveBeenCalled();

    fixture.detectChanges();
    await fixture.whenStable();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('observes the end sentinel once the group table makes the area scroll', async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    // Five of the six sections are short placeholders, so the first pass can find nothing to scroll.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });
    await setup();

    expect(FakeIntersectionObserver.instances).toHaveLength(1);

    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: window.innerHeight * 3 });
    stubChild().countsChange.emit({ groups: 34, dormantGroups: 3 });
    fixture.detectChanges();
    await fixture.whenStable();

    const sentinel = fixture.nativeElement.querySelector('[data-testid="engagement-scroll-end-sentinel"]');
    expect(endObserver().observed).toEqual([sentinel]);
  });

  it('drops a pending deep link once the user picks a section themselves', async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    await setup('reps');

    fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-nonmem"]').click();
    fixture.detectChanges();
    stubChild().countsChange.emit({ groups: 34, dormantGroups: 3 });
    fixture.detectChanges();
    await fixture.whenStable();

    // The deep link resolving late would otherwise drag the pane back off the section just picked.
    expect(activeKey()).toBe('nonmem');
  });

  // Bound on the window, so each one must still land when it is dispatched deep inside the pane —
  // which is where a reader's wheel, touch or keypress actually originates.
  it.each(['wheel', 'touchmove', 'keydown'])('drops a pending deep link on a reader %s inside the pane', async (type) => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    await setup('reps');

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    const intent = type === 'keydown' ? new KeyboardEvent(type, { key: 'PageDown', bubbles: true }) : new Event(type, { bubbles: true });
    headingOf('participation').dispatchEvent(intent);

    stubChild().countsChange.emit({ groups: 34, dormantGroups: 3 });
    fixture.detectChanges();
    await fixture.whenStable();

    // A read that fails and later succeeds would otherwise drag the pane back to the linked anchor.
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  // The rows bind `keydown.enter` / `keydown.space` and every keystroke in the shell bubbles to the
  // window, so an unfiltered handler would drop the deep link on a Tab press.
  it('keeps a pending deep link through a keystroke that does not scroll', async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    await setup('reps');

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    headingOf('participation').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    stubChild().countsChange.emit({ groups: 34, dormantGroups: 3 });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // Fake timers cover only the arm-and-wait: `whenStable` below needs the real scheduler.
  it('lets a pending deep link expire rather than scrolling into a read that never settles', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fragment.next('reps');
    vi.advanceTimersByTime(HEALTH_METRICS_ENGAGEMENT_PENDING_SECTION_TTL_MS + 1);
    vi.useRealTimers();

    scrollIntoView.mockClear();
    stubChild().countsChange.emit({ groups: 34, dormantGroups: 3 });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('restarts the deadline on the next fragment rather than letting the first one fire', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fragment.next('reps');
    vi.advanceTimersByTime(HEALTH_METRICS_ENGAGEMENT_PENDING_SECTION_TTL_MS - 1000);
    fragment.next('orgs');
    // Past the first fragment's deadline, well inside the second's.
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();

    scrollIntoView.mockClear();
    stubChild().countsChange.emit({ groups: 34, dormantGroups: 3 });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('schedules no expiry timer on the server, where the deep link is never replayed', async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await setup('reps', 'server');

    // A pending Node timer would hold the SSR render open for the whole TTL.
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), HEALTH_METRICS_ENGAGEMENT_PENDING_SECTION_TTL_MS);
  });

  it('does not hold a fragment that arrives after the section data has settled', async () => {
    stubChild().countsChange.emit({ groups: 34, dormantGroups: 3 });
    fixture.detectChanges();
    await fixture.whenStable();

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    fragment.next('reps');
    fixture.detectChanges();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    stubChild().countsChange.emit({ groups: 12, dormantGroups: 1 });
    fixture.detectChanges();
    await fixture.whenStable();

    // The anchors are stable by now, so the next filter change must not re-scroll to the fragment.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('disconnects both observers on destroy', () => {
    const heading = spyObserver();
    const end = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];

    fixture.destroy();

    expect(heading.disconnected).toBe(true);
    expect(end.disconnected).toBe(true);
  });
});
