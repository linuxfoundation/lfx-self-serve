// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../health-metrics-gate/health-metrics-chrome.service';
import { HealthMetricsL2SectionDirective } from './health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from './health-metrics-l2-shell.component';

import type { HealthMetricsL2Section, HealthMetricsL2SubNavItem } from '@lfx-one/shared/interfaces';

// Two data sections and a trailing one the host projects no body for — the shape a tab has while
// one section's data is still blocked.
const SECTIONS: HealthMetricsL2Section[] = [
  { key: 'alpha', label: 'Alpha', heading: 'Alpha heading', description: 'Alpha copy', footnote: '', footnoteCaution: false },
  { key: 'beta', label: 'Beta', heading: 'Beta heading', description: 'Beta copy', footnote: 'Beta note', footnoteCaution: false },
  { key: 'gamma', label: 'Gamma', heading: 'Gamma heading', description: 'Gamma copy', footnote: 'Gamma caution', footnoteCaution: true },
];
const DATA_SECTIONS = ['alpha', 'beta'];
// Stubbed offset for the pane's own top edge in the pane-height tests below.
const PANE_TOP_PX = 40;
const ITEMS: HealthMetricsL2SubNavItem[] = SECTIONS.map((section) => ({ key: section.key, label: section.label, count: null, note: '' }));

// Stands in for a tab's section body: the shell only reacts to what the tab relays from these.
@Component({ selector: 'lfx-test-section', template: '<p>Section body</p>' })
class TestSectionComponent {
  public readonly sectionPicked = output<string>();
  public readonly reading = output<void>();
  public readonly settled = output<void>();
}

// Composes the shell the way a tab does, relaying each section's reads to it. Set through
// `overrideComponent`, since lint caps an inline template at three lines.
const HOST_TEMPLATE = `
  <lfx-health-metrics-l2-shell
    #shell
    [sections]="sections"
    idPrefix="sec-test-"
    [dataSections]="dataSections"
    [subNavItems]="items"
    navLabel="Test sections"
    testIdPrefix="test">
    <ng-template lfxHealthMetricsL2Section="alpha">
      <lfx-test-section (sectionPicked)="shell.scrollToSection($event)" (reading)="shell.sectionReading('alpha')" (settled)="shell.sectionSettled('alpha')" />
    </ng-template>
    <ng-template lfxHealthMetricsL2Section="beta">
      <lfx-test-section (reading)="shell.sectionReading('beta')" (settled)="shell.sectionSettled('beta')" />
    </ng-template>
  </lfx-health-metrics-l2-shell>
`;

@Component({
  selector: 'lfx-test-host',
  template: '',
})
class TestHostComponent {
  protected readonly sections = SECTIONS;
  // Writable so a test can build a tab whose sections are all placeholders.
  public dataSections: readonly string[] = DATA_SECTIONS;
  protected readonly items = ITEMS;
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

// Stands in for the document-resize watcher the shell installs after first paint; jsdom has no real
// implementation, so this both satisfies `typeof ResizeObserver !== 'undefined'` and lets a test fire
// the same callback the component would get from a real footer settling.
class FakeResizeObserver implements ResizeObserver {
  public static instances: FakeResizeObserver[] = [];

  public constructor(public readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  public observe(): void {
    /* no-op */
  }
  public unobserve(): void {
    /* no-op */
  }
  public disconnect(): void {
    /* no-op */
  }

  public trigger(): void {
    this.callback([], this);
  }
}

describe('HealthMetricsL2ShellComponent', () => {
  // Both are patched onto objects this suite does not own, so they are restored after every test.
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<TestHostComponent>;
  let chrome: HealthMetricsChromeService;
  let fragment: BehaviorSubject<string | null>;

  function headingOf(key: string): Element {
    return fixture.nativeElement.querySelector(`#sec-test-${key}-heading`);
  }

  /** The heading observer — the end sentinel's is always constructed second. */
  function spyObserver(): FakeIntersectionObserver {
    return FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 2];
  }

  function endObserver(): FakeIntersectionObserver {
    return FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];
  }

  function child(key: 'alpha' | 'beta'): TestSectionComponent {
    const index = key === 'alpha' ? 0 : 1;
    return fixture.debugElement.queryAll(By.directive(TestSectionComponent))[index].componentInstance as TestSectionComponent;
  }

  /** Every data section settling, which is what releases a held deep link. */
  function allSettle(): void {
    child('alpha').settled.emit();
    child('beta').settled.emit();
  }

  function scrollIntoView(): ReturnType<typeof vi.fn> {
    return Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
  }

  async function flush(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function activeKey(): string | null {
    return fixture.nativeElement.querySelector('[aria-current="true"]')?.getAttribute('data-testid')?.replace('test-sub-nav-', '') ?? null;
  }

  /**
   * `initialFragment` is seeded before creation because that is when the real `ActivatedRoute`
   * replays it — the deep-link path only exists on that first emission.
   */
  async function setup(initialFragment: string | null = null, platformId?: string, dataSections: readonly string[] = DATA_SECTIONS): Promise<void> {
    fragment = new BehaviorSubject<string | null>(initialFragment);

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { fragment: fragment.asObservable() } },
        ...(platformId ? [{ provide: PLATFORM_ID, useValue: platformId }] : []),
      ],
    })
      .overrideComponent(TestHostComponent, {
        set: { template: HOST_TEMPLATE, imports: [HealthMetricsL2SectionDirective, HealthMetricsL2ShellComponent, TestSectionComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);
    fixture.componentInstance.dataSections = dataSections;
    fixture.detectChanges();
    // Flushes `afterNextRender`, which is where the scroll-spy is wired up.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Rebuilds the fixture, for a test that needs a different URL or document at creation. */
  async function resetup(initialFragment: string | null = null, platformId?: string, dataSections?: readonly string[]): Promise<void> {
    fixture.destroy();
    TestBed.resetTestingModule();
    FakeIntersectionObserver.instances = [];
    FakeResizeObserver.instances = [];
    await setup(initialFragment, platformId, dataSections);
  }

  /** Stubs the pane's own top edge, which is all `measurePanesHeight()` reads a rect for. */
  function stubPaneTop(): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const panes = fixture.nativeElement.querySelector('[data-testid="health-metrics-test-page"]')?.lastElementChild;
      return this === panes ? ({ top: PANE_TOP_PX, bottom: 0 } as unknown as DOMRect) : ({ top: 0, bottom: 0 } as unknown as DOMRect);
    });
  }

  beforeEach(async () => {
    FakeIntersectionObserver.instances = [];
    FakeResizeObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    // jsdom reports a zero-height document, which would read as a page that needs no scrolling and
    // skip the end sentinel entirely. `measurePanesHeight()` also reads this (see its own doc
    // comment), so the pane-height tests below get 50px of "chrome below" for free from this default.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: window.innerHeight + 50 });
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

  it('renders every section with its prefixed anchor id, copy and projected body', () => {
    for (const section of SECTIONS) {
      const element = fixture.nativeElement.querySelector(`[data-testid="test-section-${section.key}"]`);

      expect(element.getAttribute('id')).toBe(`sec-test-${section.key}`);
      expect(element.textContent).toContain(section.heading);
      expect(element.textContent).toContain(section.description);
    }
    expect(fixture.nativeElement.querySelector('[data-testid="test-section-beta"]').textContent).toContain('Section body');
  });

  it('holds an anchored placeholder for a section the tab projects no body for', () => {
    const gamma = fixture.nativeElement.querySelector('[data-testid="test-section-gamma"]');

    expect(gamma.textContent).toContain('Awaiting data');
    expect(gamma.textContent).not.toContain('Section body');
  });

  it('renders footnotes, marking only the cautioned one', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="test-section-beta"]').textContent).toContain('Beta note');
    expect(fixture.nativeElement.querySelectorAll('.fa-triangle-exclamation')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[data-testid="test-section-gamma"] .fa-triangle-exclamation')).not.toBeNull();
  });

  it('labels the sub-nav and starts with the first section active', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="test-sub-nav"]').getAttribute('aria-label')).toBe('Test sections');
    expect(activeKey()).toBe('alpha');
  });

  it('bounds the scrolling pane to what is left of the viewport, measuring the chrome below it', async () => {
    // jsdom lays out nothing, so the pane's own top edge is stubbed; the stubbed document is 50px
    // taller than the viewport, which measurePanesHeight() reads as 50px of chrome (gate padding,
    // layout padding, the footer) below the pane.
    stubPaneTop();
    await resetup();

    const panes = fixture.nativeElement.querySelector('[data-testid="health-metrics-test-page"]').lastElementChild as HTMLElement;

    expect(panes.className).toContain('lg:overflow-y-auto');
    expect(panes.style.getPropertyValue('--l2-panes-height')).toBe(`${window.innerHeight - PANE_TOP_PX - 50}px`);
  });

  it('clamps the pane to the minimum height when the chrome below it exceeds the viewport', async () => {
    // Same rect stub as the test above, so the clamp is driven by the oversized scrollHeight below
    // rather than by jsdom's default zero rects (which would clamp regardless of that value).
    stubPaneTop();
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: window.innerHeight * 10 });
    await resetup();

    const panes = fixture.nativeElement.querySelector('[data-testid="health-metrics-test-page"]').lastElementChild as HTMLElement;

    expect(panes.style.getPropertyValue('--l2-panes-height')).toBe('320px');
  });

  it('fills the pane to the viewport bottom before reading the chrome below it, so a short page is not misread as having none', async () => {
    // The bug this guards: reading the document/viewport gap without first filling the pane would
    // count the layout's `min-h-screen` flex-grow slack from a short page as real chrome, and once the
    // pane is sized to fit, its own output keeps feeding that same slack back on every re-measure.
    // Filling first forces the document to be at least viewport-tall, so the slack cannot appear.
    stubPaneTop();
    await resetup();

    const panes = fixture.nativeElement.querySelector('[data-testid="health-metrics-test-page"]').lastElementChild as HTMLElement;
    const setProperty = vi.spyOn(panes.style, 'setProperty');

    chrome.headerHeightPx.set(120);
    fixture.detectChanges();

    const heights = setProperty.mock.calls.filter(([name]) => name === '--l2-panes-height').map(([, value]) => value);
    // The first write fills to the viewport bottom with no chrome subtracted yet; only the second,
    // final write accounts for the 50px the stubbed document reports below that.
    expect(heights[0]).toBe(`${window.innerHeight - PANE_TOP_PX}px`);
    expect(heights[1]).toBe(`${window.innerHeight - PANE_TOP_PX - 50}px`);
  });

  it('re-measures the pane when the document resizes after first paint', async () => {
    stubPaneTop();
    await resetup();

    const panes = fixture.nativeElement.querySelector('[data-testid="health-metrics-test-page"]').lastElementChild as HTMLElement;
    const spyBefore = spyObserver();

    // Simulates the footer settling asynchronously, after the pane's first measurement. Still well
    // past the innerHeight+1 threshold areaScrolls() checks, so the spy's root doesn't change either.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: window.innerHeight + 90 });
    FakeResizeObserver.instances[0].trigger();
    // The debounced subscriber runs on a real timer; 200ms clears the 150ms debounceTime with margin.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flush();

    expect(panes.style.getPropertyValue('--l2-panes-height')).toBe(`${window.innerHeight - PANE_TOP_PX - 90}px`);
    // The scroll root didn't change, so the spy is left alone rather than rebuilt for nothing.
    expect(spyObserver()).toBe(spyBefore);
  });

  it('rebuilds the scroll spy when a document resize makes the area newly scrollable', async () => {
    // Starts with nothing to scroll, so areaScrolls() is false and only the heading observer exists.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });
    stubPaneTop();
    await resetup();

    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    const spyBefore = spyObserver();

    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: window.innerHeight * 3 });
    FakeResizeObserver.instances[0].trigger();
    // 200ms clears the 150ms debounceTime with margin.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flush();

    // The rebuild tears down the heading observer and creates a new heading observer plus an end
    // observer, now that the area genuinely overflows.
    expect(spyObserver()).not.toBe(spyBefore);
    expect(FakeIntersectionObserver.instances).toHaveLength(3);
  });

  it('observes each section heading below the measured sticky header', () => {
    const observer = spyObserver();

    expect(observer.observed).toHaveLength(SECTIONS.length);
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

    observer.fire(headingOf('gamma'), true);
    observer.fire(headingOf('beta'), true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(activeKey()).toBe('beta');

    // Scrolling the earlier heading out hands the highlight to the next one down, not to nothing.
    observer.fire(headingOf('beta'), false);
    fixture.detectChanges();
    expect(activeKey()).toBe('gamma');
  });

  it('keeps the last active item when nothing is intersecting mid-scroll', () => {
    const observer = spyObserver();

    observer.fire(headingOf('beta'), true);
    fixture.detectChanges();
    observer.fire(headingOf('beta'), false);
    fixture.detectChanges();

    expect(activeKey()).toBe('beta');
  });

  it('follows a section fragment, and ignores one that is not a section', () => {
    const scrollIntoViewSpy = vi.fn();
    vi.spyOn(document, 'getElementById').mockReturnValue({ scrollIntoView: scrollIntoViewSpy } as unknown as HTMLElement);

    fragment.next('beta');
    fixture.detectChanges();
    expect(activeKey()).toBe('beta');
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    // The allowlist is what keeps an arbitrary fragment from driving the rail.
    fragment.next('sec-test-beta');
    fragment.next('delta');
    fragment.next(null);
    fixture.detectChanges();
    expect(activeKey()).toBe('beta');
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('scrolls to the section the sub-nav emits', () => {
    const scrollIntoViewSpy = vi.fn();
    vi.spyOn(document, 'getElementById').mockReturnValue({ scrollIntoView: scrollIntoViewSpy } as unknown as HTMLElement);

    fixture.nativeElement.querySelector('[data-testid="test-sub-nav-gamma"]').click();
    fixture.detectChanges();

    expect(activeKey()).toBe('gamma');
    expect(scrollIntoViewSpy).toHaveBeenCalledOnce();
  });

  it('scrolls to a fragment that was already in the URL before the sections existed', async () => {
    await resetup('gamma');

    expect(activeKey()).toBe('gamma');
    // The fragment emits before the view exists, so this only happens if the deep link is replayed
    // after render.
    expect(scrollIntoView()).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('lights the last section when the end sentinel is reached', () => {
    const sentinel = fixture.nativeElement.querySelector('[data-testid="test-scroll-end-sentinel"]');

    expect(endObserver().observed).toEqual([sentinel]);

    endObserver().fire(sentinel, true);
    fixture.detectChanges();

    // The last section is too short for its heading to reach the activation band, so the sentinel is
    // the only thing that can activate it.
    expect(activeKey()).toBe('gamma');
  });

  it('skips the end sentinel when there is nothing to scroll', async () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });
    await resetup();

    // Otherwise the sentinel intersects from first paint and pins the rail to the last section.
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
  });

  it('re-runs the deep-link scroll only once the settled section has painted', async () => {
    await resetup('gamma');

    scrollIntoView().mockClear();
    child('beta').settled.emit();

    // Scrolling in the emitting turn would read the offsets from before the rows were laid out.
    expect(scrollIntoView()).not.toHaveBeenCalled();

    await flush();
    expect(scrollIntoView()).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('observes the end sentinel once a settled section makes the area scroll', async () => {
    // Short placeholder sections can leave the first pass with nothing to scroll.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });
    await resetup();

    expect(FakeIntersectionObserver.instances).toHaveLength(1);

    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: window.innerHeight * 3 });
    child('beta').settled.emit();
    await flush();

    const sentinel = fixture.nativeElement.querySelector('[data-testid="test-scroll-end-sentinel"]');
    expect(endObserver().observed).toEqual([sentinel]);
  });

  it('drops a pending deep link once the user picks a section themselves', async () => {
    await resetup('gamma');

    fixture.nativeElement.querySelector('[data-testid="test-sub-nav-beta"]').click();
    fixture.detectChanges();
    child('beta').settled.emit();
    await flush();

    // The deep link resolving late would otherwise drag the pane back off the section just picked.
    expect(activeKey()).toBe('beta');
  });

  // Bound on the window, so each one must still land when it is dispatched deep inside the pane —
  // which is where a reader's wheel, touch or keypress actually originates.
  it.each(['wheel', 'touchmove', 'keydown'])('drops a pending deep link on a reader %s inside the pane', async (type) => {
    await resetup('gamma');

    scrollIntoView().mockClear();
    const intent = type === 'keydown' ? new KeyboardEvent(type, { key: 'PageDown', bubbles: true }) : new Event(type, { bubbles: true });
    headingOf('alpha').dispatchEvent(intent);

    child('beta').settled.emit();
    await flush();

    // A read that fails and later succeeds would otherwise drag the pane back to the linked anchor.
    expect(scrollIntoView()).not.toHaveBeenCalled();
  });

  // Every keystroke in the app shell bubbles to the window, so an unfiltered handler would drop the
  // deep link on a Tab press.
  it('keeps a pending deep link through a keystroke that does not scroll', async () => {
    await resetup('gamma');

    scrollIntoView().mockClear();
    headingOf('alpha').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    child('beta').settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);
  });

  // A row binds `keydown.space` and calls `preventDefault()` on it — that key opened a drawer, it
  // did not move the pane, so the deep link must survive it.
  it('keeps a pending deep link through a space that a row has already handled', async () => {
    await resetup('gamma');

    scrollIntoView().mockClear();
    const heading = headingOf('alpha');
    heading.addEventListener('keydown', (event: Event) => event.preventDefault(), { once: true });
    heading.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));

    child('beta').settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);
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
    await resetup('gamma');

    scrollIntoView().mockClear();
    const target = makeTarget();
    document.body.appendChild(target);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    target.remove();

    child('beta').settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);
  });

  // Fake timers cover only the arm-and-wait: `whenStable` below needs the real scheduler.
  it('lets a pending deep link expire rather than scrolling into a read that never settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fragment.next('gamma');
    vi.advanceTimersByTime(HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS + 1);
    vi.useRealTimers();

    scrollIntoView().mockClear();
    child('beta').settled.emit();
    await flush();

    expect(scrollIntoView()).not.toHaveBeenCalled();
  });

  it('restarts the deadline on the next fragment rather than letting the first one fire', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fragment.next('gamma');
    vi.advanceTimersByTime(HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS - 1000);
    fragment.next('beta');
    // Past the first fragment's deadline, well inside the second's.
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();

    scrollIntoView().mockClear();
    child('beta').settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);
  });

  // A page clamp re-reads without ever settling the first read, so the deadline has to restart
  // against the new read rather than expiring on the fragment that armed it.
  it('restarts the deadline when a section reports a fresh read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fragment.next('gamma');
    vi.advanceTimersByTime(HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS - 1000);
    child('beta').reading.emit();
    // Past the deadline the fragment armed, well inside the one the read restarted.
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();

    scrollIntoView().mockClear();
    child('beta').settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);
  });

  // Whichever section settles first, the other is still loading and owns releasing the key.
  it.each([
    ['alpha', 'beta'],
    ['beta', 'alpha'],
  ] as const)('re-anchors a pending deep link when %s settles, and again when %s settles last', async (first, last) => {
    fragment.next('gamma');
    scrollIntoView().mockClear();

    child(first).settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);

    child(last).settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(2);

    // Every data section has settled, so the key is released: a further settle does not re-scroll.
    child(first).settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(2);
  });

  it('scrolls to the section a cross-link emits, and drops the pending deep link', async () => {
    fragment.next('gamma');
    scrollIntoView().mockClear();

    child('alpha').sectionPicked.emit('beta');
    await flush();

    expect(activeKey()).toBe('beta');
    expect(scrollIntoView()).toHaveBeenCalledTimes(1);

    child('beta').settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);
  });

  // Only Space is swallowed by a button. Activating a filter is exactly when a reader scrolls on,
  // so every other scroll key still counts with that button focused.
  it('drops a pending deep link on a PageDown pressed with a button focused', async () => {
    fragment.next('gamma');
    fixture.detectChanges();

    scrollIntoView().mockClear();
    const target = document.createElement('button');
    document.body.appendChild(target);
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    target.remove();

    child('beta').settled.emit();
    await flush();

    expect(scrollIntoView()).not.toHaveBeenCalled();
  });

  // Every read restarts the deadline, and each restart arms again. Without the guard in
  // `observeReaderIntent` those arms would stack a fresh handler on each stream every time.
  it('registers the reader-intent listeners once across repeated arms', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    fragment.next('gamma');
    fixture.detectChanges();

    // Two further reads starting, each re-arming the key already pending.
    child('beta').reading.emit();
    fixture.detectChanges();
    child('beta').reading.emit();
    await flush();

    for (const type of ['wheel', 'touchmove', 'keydown']) {
      expect(addEventListener.mock.calls.filter(([registered]) => registered === type)).toHaveLength(1);
    }
  });

  // The handlers sit on three of the browser's hottest event streams, so a settled read has to
  // give them back rather than leave them running for the rest of the page's life.
  it('unregisters the reader-intent listeners once every section has settled', async () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    fragment.next('gamma');
    fixture.detectChanges();

    allSettle();
    await flush();

    for (const type of ['wheel', 'touchmove', 'keydown']) expect(removeEventListener).toHaveBeenCalledWith(type, expect.any(Function));
  });

  // The listeners are registered per arm: registering them once at construction left a link armed
  // after the first settle with nothing but the TTL protecting it.
  it('cancels a deep link armed after an earlier read has already settled', async () => {
    child('beta').settled.emit();
    await flush();

    // A filter change starts a fresh read, which is what lets the next fragment arm again.
    child('beta').reading.emit();
    fixture.detectChanges();
    fragment.next('gamma');
    fixture.detectChanges();

    scrollIntoView().mockClear();
    headingOf('alpha').dispatchEvent(new Event('wheel', { bubbles: true }));

    child('beta').settled.emit();
    await flush();

    expect(scrollIntoView()).not.toHaveBeenCalled();
  });

  // A tab of placeholders has nothing to settle, so only the first render can land the link.
  it('replays an initial fragment once for a tab with no data sections', async () => {
    await resetup('gamma', undefined, []);

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);

    // Released straight after that replay: a later settle finds no held key to scroll back to.
    fixture.debugElement.query(By.directive(HealthMetricsL2ShellComponent)).componentInstance.sectionSettled('alpha');
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);
  });

  it('schedules no expiry timer on the server, where the deep link is never replayed', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await resetup('gamma', 'server');

    // A pending Node timer would hold the SSR render open for the whole TTL.
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS);
  });

  it('does not hold a fragment that arrives after every section has settled', async () => {
    allSettle();
    await flush();

    scrollIntoView().mockClear();
    fragment.next('gamma');
    fixture.detectChanges();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);

    child('beta').reading.emit();
    child('beta').settled.emit();
    await flush();

    // The anchors are stable by now, so the next filter change must not re-scroll to the fragment.
    expect(scrollIntoView()).toHaveBeenCalledTimes(1);
  });

  // The first full settle must not be the last: a period change re-reads each section, so a fragment
  // arriving during that reflow needs the same hold the first load gets.
  it.each(['alpha', 'beta'] as const)('holds a fragment that arrives while a later %s read is in flight', async (key) => {
    allSettle();
    await flush();

    child(key).reading.emit();
    fixture.detectChanges();

    scrollIntoView().mockClear();
    fragment.next('gamma');
    fixture.detectChanges();

    expect(scrollIntoView()).toHaveBeenCalledTimes(1);

    child(key).settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(2);

    // The key is released now, so a later settle is not another yank back to the anchor.
    child(key).settled.emit();
    await flush();

    expect(scrollIntoView()).toHaveBeenCalledTimes(2);
  });

  it('disconnects both observers on destroy', () => {
    const heading = spyObserver();
    const end = endObserver();

    fixture.destroy();

    expect(heading.disconnected).toBe(true);
    expect(end.disconnected).toBe(true);
  });
});
