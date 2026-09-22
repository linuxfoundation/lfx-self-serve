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

import type { HealthMetricsEngagementGroupCounts, HealthMetricsEngagementSectionKey } from '@lfx-one/shared/interfaces';

// Stands in for the real Group attendance section, matched by selector — this spec covers the shell,
// and the real one would drag in HttpClient and the analytics read.
@Component({ selector: 'lfx-engagement-group-attendance', template: '' })
class GroupAttendanceStubComponent {
  public readonly countsChange = output<HealthMetricsEngagementGroupCounts | null>();
  public readonly reading = output<void>();
  public readonly settled = output<void>();
}

// Same stand-in for Meeting participation: the shell only reacts to its two outputs.
@Component({ selector: 'lfx-engagement-meeting-participation', template: '' })
class MeetingParticipationStubComponent {
  public readonly sectionPicked = output<HealthMetricsEngagementSectionKey>();
  public readonly reading = output<void>();
  public readonly settled = output<void>();
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

  function participationChild(): MeetingParticipationStubComponent {
    return fixture.debugElement.query(By.directive(MeetingParticipationStubComponent)).componentInstance as MeetingParticipationStubComponent;
  }

  function stubChild(): GroupAttendanceStubComponent {
    return fixture.debugElement.query(By.directive(GroupAttendanceStubComponent)).componentInstance as GroupAttendanceStubComponent;
  }

  /** One settled group read: the badge counts, then the settle the deep link actually waits on. */
  function groupSettles(counts: HealthMetricsEngagementGroupCounts | null = { groups: 34, dormantGroups: 3 }): void {
    stubChild().countsChange.emit(counts);
    stubChild().settled.emit();
  }

  /** A group read starting — the badges drop and the section stops counting as settled. */
  function groupReads(): void {
    stubChild().countsChange.emit(null);
    stubChild().reading.emit();
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
      .overrideComponent(HealthMetricsEngagementComponent, {
        set: { imports: [EngagementSubNavComponent, GroupAttendanceStubComponent, MeetingParticipationStubComponent] },
      })
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
    groupSettles();

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
    groupSettles();
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
    groupSettles();
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

    groupSettles();
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

    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // A row binds `keydown.space` and calls `preventDefault()` on it — that key opened a drawer, it
  // did not move the pane, so the deep link must survive it.
  it('keeps a pending deep link through a space that a row has already handled', async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    await setup('reps');

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    const heading = headingOf('participation');
    heading.addEventListener('keydown', (event: Event) => event.preventDefault(), { once: true });
    heading.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // Space and the arrow keys type or move a caret inside a field, and Space on a button activates
  // it without marking the event defaultPrevented; none of them scrolls.
  it.each([
    ['an input', () => document.createElement('input')],
    ['a button', () => document.createElement('button')],
    [
      'a contentEditable element',
      () => {
        const host = document.createElement('div');
        host.contentEditable = 'true';
        // jsdom does not derive `isContentEditable` from the attribute.
        Object.defineProperty(host, 'isContentEditable', { value: true });
        return host;
      },
    ],
  ])('keeps a pending deep link through a space typed into %s', async (_label, makeTarget) => {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    await setup('reps');

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    const target = makeTarget();
    document.body.appendChild(target);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    target.remove();

    groupSettles();
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
    groupSettles();
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
    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // A page clamp re-reads without ever settling the first read, so the deadline has to restart
  // against the new read rather than expiring on the fragment that armed it.
  it('restarts the deadline when the section reports a fresh read', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fragment.next('reps');
    vi.advanceTimersByTime(HEALTH_METRICS_ENGAGEMENT_PENDING_SECTION_TTL_MS - 1000);
    groupReads();
    // Past the deadline the fragment armed, well inside the one the read restarted.
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();

    scrollIntoView.mockClear();
    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // Participation sits above every anchor below it, so its read landing moves them — but group
  // attendance, still loading, owns clearing the key.
  it('re-anchors a pending deep link when participation settles, and leaves it armed', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    fragment.next('reps');
    scrollIntoView.mockClear();

    participationChild().settled.emit();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  // The reverse order is the regression: releasing the key on the first section to report left
  // participation's own reflow — which moves every anchor below it — unanswered.
  it('re-anchors a pending deep link when participation settles last', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    fragment.next('reps');
    scrollIntoView.mockClear();

    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    participationChild().settled.emit();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('scrolls to the section a participation cross-link emits, and drops the pending deep link', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    fragment.next('reps');
    scrollIntoView.mockClear();

    participationChild().sectionPicked.emit('committees');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(activeKey()).toBe('committees');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // Only Space is swallowed by a button. Activating a filter is exactly when a reader scrolls on,
  // so every other scroll key still counts with that button focused.
  it('drops a pending deep link on a PageDown pressed with a button focused', async () => {
    fragment.next('reps');
    fixture.detectChanges();

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    target.remove();

    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  // Every read restarts the deadline, and each restart arms again. Without the guard in
  // `observeReaderIntent` those arms would stack a fresh handler on each stream every time.
  it('registers the reader-intent listeners once across repeated arms', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    fragment.next('reps');
    fixture.detectChanges();

    // Two further reads starting, each re-arming the key already pending.
    groupReads();
    fixture.detectChanges();
    groupReads();
    fixture.detectChanges();
    await fixture.whenStable();

    for (const type of ['wheel', 'touchmove', 'keydown']) {
      expect(addEventListener.mock.calls.filter(([registered]) => registered === type)).toHaveLength(1);
    }
  });

  // The handlers sit on three of the browser's hottest event streams, so a settled read has to
  // give them back rather than leave them running for the rest of the page's life.
  it('unregisters the reader-intent listeners once every section has settled', async () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    fragment.next('reps');
    fixture.detectChanges();

    groupSettles();
    participationChild().settled.emit();
    fixture.detectChanges();
    await fixture.whenStable();

    for (const type of ['wheel', 'touchmove', 'keydown']) expect(removeEventListener).toHaveBeenCalledWith(type, expect.any(Function));
  });

  // The listeners are registered per arm: registering them once at construction left a link armed
  // after the first settle with nothing but the TTL protecting it.
  it('cancels a deep link armed after an earlier read has already settled', async () => {
    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    // A filter change starts a fresh read, which is what lets the next fragment arm again.
    groupReads();
    fixture.detectChanges();
    fragment.next('reps');
    fixture.detectChanges();

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    headingOf('participation').dispatchEvent(new Event('wheel', { bubbles: true }));

    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).not.toHaveBeenCalled();
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

  it('does not hold a fragment that arrives after every section has settled', async () => {
    groupSettles();
    participationChild().settled.emit();
    fixture.detectChanges();
    await fixture.whenStable();

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    fragment.next('reps');
    fixture.detectChanges();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    groupReads();
    groupSettles({ groups: 12, dormantGroups: 1 });
    fixture.detectChanges();
    await fixture.whenStable();

    // The anchors are stable by now, so the next filter change must not re-scroll to the fragment.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // The first full settle must not be the last: a period change re-reads both sections, so a
  // fragment arriving during that reflow needs the same hold the first load gets.
  it('holds a fragment that arrives while a later read is in flight', async () => {
    groupSettles();
    participationChild().settled.emit();
    fixture.detectChanges();
    await fixture.whenStable();

    groupReads();
    fixture.detectChanges();

    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();
    fragment.next('reps');
    fixture.detectChanges();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    groupSettles();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  // A failed read and a foundation-less one both end on `null` counts. Waiting for counts that
  // never come would pin the key until the TTL and re-scroll on every settle in between.
  it('releases a pending deep link when the group read settles without counts', async () => {
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    fragment.next('reps');
    scrollIntoView.mockClear();

    participationChild().settled.emit();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    groupSettles(null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    participationChild().settled.emit();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('disconnects both observers on destroy', () => {
    const heading = spyObserver();
    const end = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];

    fixture.destroy();

    expect(heading.disconnected).toBe(true);
    expect(end.disconnected).toBe(true);
  });
});
