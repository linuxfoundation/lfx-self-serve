// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiScrollerDirection } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiScrollerComponent } from './scroller.component';

class ResizeObserverStub {
  public static instances: ResizeObserverStub[] = [];
  public observed: Element[] = [];
  public disconnected = false;

  public constructor(public readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  public observe(target: Element): void {
    this.observed.push(target);
  }

  public disconnect(): void {
    this.disconnected = true;
    this.observed = [];
  }
}

@Component({
  selector: 'lfx-ui-scroller-test-host',
  imports: [UiScrollerComponent],
  // prettier-ignore
  template: `<lfx-ui-scroller label="Projects" [direction]="direction()" [buttons]="buttons()">@for (item of items(); track item) {<span>{{ item }}</span>}</lfx-ui-scroller>`,
})
class HostComponent {
  public readonly direction = input<UiScrollerDirection>('horizontal');
  public readonly buttons = input<boolean>(true);
  public readonly items = signal(['A', 'B', 'C']);
}

describe('UiScrollerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  const viewport = (): HTMLElement => host.querySelector('[data-testid="ui-scroller-viewport"]') as HTMLElement;
  const prev = (): HTMLButtonElement | null => host.querySelector('[data-testid="ui-scroller-prev"]');
  const next = (): HTMLButtonElement | null => host.querySelector('[data-testid="ui-scroller-next"]');

  /** jsdom has no layout, so give the viewport its scroll metrics. */
  const setMetrics = (metrics: {
    scrollLeft?: number;
    scrollWidth?: number;
    clientWidth?: number;
    scrollTop?: number;
    scrollHeight?: number;
    clientHeight?: number;
  }): void => {
    Object.entries(metrics).forEach(([key, value]) => Object.defineProperty(viewport(), key, { value, configurable: true, writable: true }));
  };

  beforeEach(async () => {
    ResizeObserverStub.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    );
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('names a focusable scroll region', () => {
    expect(viewport().getAttribute('role')).toBe('region');
    expect(viewport().getAttribute('aria-label')).toBe('Projects');
    expect(viewport().tabIndex).toBe(0);
    expect(host.querySelector('[data-testid="ui-scroller-frame"]')?.className).toContain('focus-visible');
  });

  it('observes the viewport and each item after the first render', () => {
    const observer = ResizeObserverStub.instances[0];
    expect(observer.observed.length).toBe(4);
    expect(observer.observed[0]).toBe(viewport());
  });

  it('disconnects both observers on destroy', () => {
    const mutationDisconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    fixture.destroy();

    expect(ResizeObserverStub.instances[0].disconnected).toBe(true);
    expect(mutationDisconnect).toHaveBeenCalled();
  });

  it('observes and measures an item added after the first render', async () => {
    setMetrics({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    expect(viewport().style.getPropertyValue('--fade-end')).toBe('0px');

    fixture.componentInstance.items.update((items) => [...items, 'D']);
    await fixture.whenStable();
    // The mutation callback runs as a microtask after the new item renders.
    await Promise.resolve();
    await fixture.whenStable();

    const observed = ResizeObserverStub.instances[0].observed;
    expect(observed).toContain(viewport().children[3]);
    expect(observed.length).toBe(5);
    expect(viewport().style.getPropertyValue('--fade-end')).toBe('48px');
  });

  it('snaps horizontally by default with a fixed gap and hidden scrollbar', () => {
    expect(viewport().className).toContain('snap-mandatory');
    expect(viewport().className).toContain('overflow-x-auto');
    expect(viewport().className).toContain('gap-[12px]');
  });

  it('fades only the clipped edges: end at the start, both mid-way, start at the end', async () => {
    setMetrics({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(viewport().style.getPropertyValue('--fade-start')).toBe('0px');
    expect(viewport().style.getPropertyValue('--fade-end')).toBe('48px');

    setMetrics({ scrollLeft: 200 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(viewport().style.getPropertyValue('--fade-start')).toBe('24px');
    expect(viewport().style.getPropertyValue('--fade-end')).toBe('48px');

    setMetrics({ scrollLeft: 500 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(viewport().style.getPropertyValue('--fade-start')).toBe('24px');
    expect(viewport().style.getPropertyValue('--fade-end')).toBe('0px');
  });

  it('shows no scroll buttons while nothing overflows', () => {
    expect(prev()).toBeNull();
    expect(next()).toBeNull();
  });

  it('shows labelled buttons once content overflows and disables the one at the edge', async () => {
    setMetrics({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();

    expect(prev()?.getAttribute('aria-label')).toBe('Previous Projects');
    expect(next()?.getAttribute('aria-label')).toBe('Next Projects');
    expect(prev()?.getAttribute('aria-disabled')).toBe('true');
    expect(prev()?.disabled).toBe(false);
    expect(next()?.hasAttribute('aria-disabled')).toBe(false);
  });

  it('keeps focus on a button that reaches its end and ignores clicks on it', async () => {
    setMetrics({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    const scrollBy = vi.fn();
    viewport().scrollBy = scrollBy;
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    (next() as HTMLButtonElement).focus();

    setMetrics({ scrollLeft: 500 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    next()?.click();

    expect(next()?.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(next());
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('moves focus to the viewport when a focused button disappears because nothing overflows', async () => {
    setMetrics({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    (next() as HTMLButtonElement).focus();

    setMetrics({ scrollWidth: 300 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();

    expect(next()).toBeNull();
    expect(document.activeElement).toBe(viewport());
  });

  it('leaves focus on a projected button when the viewport scrolls and the scroller has no buttons of its own', async () => {
    fixture.componentRef.setInput('buttons', false);
    await fixture.whenStable();
    const projected = document.createElement('button');
    viewport().appendChild(projected);
    projected.focus();

    setMetrics({ scrollLeft: 200, scrollWidth: 800, clientWidth: 300 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();

    expect(document.activeElement).toBe(projected);
  });

  it('moves focus to the viewport when `buttons` is turned off while a button has focus', async () => {
    setMetrics({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    (next() as HTMLButtonElement).focus();

    fixture.componentRef.setInput('buttons', false);
    await fixture.whenStable();

    expect(next()).toBeNull();
    expect(document.activeElement).toBe(viewport());
  });

  it('measures again when the direction changes', async () => {
    setMetrics({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300, scrollTop: 0, scrollHeight: 500, clientHeight: 200 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(viewport().style.getPropertyValue('--fade-end')).toBe('0px');

    fixture.componentRef.setInput('direction', 'vertical');
    await fixture.whenStable();

    expect(viewport().style.getPropertyValue('--fade-end')).toBe('40px');
  });

  it('measures again when the text inside an item changes', async () => {
    setMetrics({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(viewport().style.getPropertyValue('--fade-end')).toBe('0px');

    setMetrics({ scrollWidth: 800 });
    (viewport().children[0].firstChild as Text).data = 'A much longer label';
    // The mutation callback runs as a microtask.
    await Promise.resolve();
    await fixture.whenStable();

    expect(viewport().style.getPropertyValue('--fade-end')).toBe('48px');
  });

  it('moves one item per click, using the spacing between the first two items', async () => {
    setMetrics({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    const items = viewport().children;
    Object.defineProperty(items[0], 'offsetLeft', { value: 2, configurable: true });
    Object.defineProperty(items[1], 'offsetLeft', { value: 214, configurable: true });
    const scrollBy = vi.fn();
    viewport().scrollBy = scrollBy;
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();

    next()?.click();

    expect(scrollBy).toHaveBeenCalledWith({ left: 212, behavior: 'smooth' });

    setMetrics({ scrollLeft: 212 });
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    prev()?.click();

    expect(scrollBy).toHaveBeenLastCalledWith({ left: -212, behavior: 'smooth' });
  });

  it('jumps instead of gliding under reduced motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }))
    );
    setMetrics({ scrollLeft: 0, scrollWidth: 800, clientWidth: 300 });
    Object.defineProperty(viewport().children[0], 'offsetLeft', { value: 0, configurable: true });
    Object.defineProperty(viewport().children[1], 'offsetLeft', { value: 150, configurable: true });
    const scrollBy = vi.fn();
    viewport().scrollBy = scrollBy;
    viewport().dispatchEvent(new Event('scroll'));
    await fixture.whenStable();

    next()?.click();

    expect(scrollBy).toHaveBeenCalledWith({ left: 150, behavior: 'auto' });
  });

  it('fades the bottom of a vertical list up to its height cap, with no buttons', async () => {
    const vertical = TestBed.createComponent(HostComponent);
    vertical.componentRef.setInput('direction', 'vertical');
    await vertical.whenStable();
    const el = vertical.nativeElement.querySelector('[data-testid="ui-scroller-viewport"]') as HTMLElement;
    Object.defineProperty(el, 'scrollHeight', { value: 600, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 220, configurable: true });
    el.dispatchEvent(new Event('scroll'));
    await vertical.whenStable();

    expect(el.className).toContain('flex-col');
    expect(el.style.maxHeight).toBe('220px');
    expect(el.style.getPropertyValue('--fade-end')).toBe('40px');
    expect(vertical.nativeElement.querySelector('[data-testid="ui-scroller-next"]')).toBeNull();
  });

  it('scrolls freely on both axes without fade', async () => {
    const both = TestBed.createComponent(HostComponent);
    both.componentRef.setInput('direction', 'both');
    await both.whenStable();
    const el = both.nativeElement.querySelector('[data-testid="ui-scroller-viewport"]') as HTMLElement;

    expect(el.className).toContain('overflow-auto');
    expect(el.className).not.toContain('scroller-x');
    expect(el.className).not.toContain('scroller-y');
  });
});
