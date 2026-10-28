// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NAV_TOOLTIP_HIDE_DELAY_MS, NAV_TOOLTIP_OFFSET_PX, NAV_TOOLTIP_RAIL_OFFSET_PX, NAV_TOOLTIP_SHOW_DELAY_MS } from '@lfx-one/shared/constants';
import type { NavTooltipItem, NavTooltipPlacement } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavTooltipDirective } from './nav-tooltip.directive';

@Component({
  selector: 'lfx-nav-tooltip-test-host',
  imports: [NavTooltipDirective],
  template: `<button type="button" data-testid="first" lfxNavTooltip="First" [lfxNavTooltipItems]="items()" (lfxNavTooltipItemSelected)="selected.set($event)">
      First</button
    ><button type="button" data-testid="second" lfxNavTooltip="Second" [lfxNavTooltipPlacement]="secondPlacement()">Second</button>`,
})
class HostComponent {
  public readonly items = signal<NavTooltipItem[]>([]);
  public readonly selected = signal<NavTooltipItem | null>(null);
  public readonly secondPlacement = signal<NavTooltipPlacement>('top');
}

const tooltips = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="nav-tooltip"]'));

describe('NavTooltipDirective', () => {
  let host: HostComponent;
  let first: HTMLElement;
  let second: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
    first = fixture.nativeElement.querySelector('[data-testid="first"]');
    second = fixture.nativeElement.querySelector('[data-testid="second"]');
    // After the fixture settles: stabilising waits on real timers.
    vi.useFakeTimers();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('shows a label-only tooltip after the hover delay and removes it after leave', () => {
    first.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tooltips()).toHaveLength(0);

    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);
    expect(tooltips()).toHaveLength(1);
    expect(tooltips()[0].textContent).toBe('First');
    expect(tooltips()[0].getAttribute('aria-hidden')).toBe('true');

    first.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS);
    expect(tooltips()).toHaveLength(0);
  });

  it('keeps a label-only tooltip open while the pointer crosses into it (WCAG 1.4.13)', () => {
    first.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);

    first.dispatchEvent(new MouseEvent('mouseleave'));
    tooltips()[0].dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS);
    expect(tooltips()).toHaveLength(1);
    expect(tooltips()[0].hasAttribute('tabindex')).toBe(false);

    tooltips()[0].dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS);
    expect(tooltips()).toHaveLength(0);
  });

  it('keeps at most one tooltip on screen', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();
    first.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);
    // Interactive tooltips linger through their hide delay; the next one replaces it at once.
    first.dispatchEvent(new MouseEvent('mouseleave'));
    second.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);

    expect(tooltips().map((tooltip) => tooltip.textContent)).toEqual(['Second']);
  });

  it('renders items as chips that emit the chosen item and close the card', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();
    first.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);

    const chip = document.body.querySelector<HTMLElement>('[data-testid="nav-tooltip-chip-k8s"]');
    expect(tooltips()[0].getAttribute('role')).toBe('group');
    chip?.click();

    expect(host.selected()).toEqual({ key: 'k8s', label: 'Kubernetes' });
    expect(tooltips()).toHaveLength(0);
  });

  it('renders a static item as a plain label that is never focused or emitted', () => {
    host.items.set([
      { key: 'k8s', label: 'Kubernetes', static: true },
      { key: 'cncf', label: 'CNCF' },
    ]);
    TestBed.tick();
    first.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);

    const label = document.body.querySelector<HTMLElement>('[data-testid="nav-tooltip-chip-k8s"]');
    expect(label?.tagName).toBe('SPAN');
    label?.click();
    expect(host.selected()).toBeNull();

    // ArrowDown skips the label and lands on the first chip button.
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.activeElement?.getAttribute('data-testid')).toBe('nav-tooltip-chip-cncf');
  });

  it('hideWithin closes the open tooltip only when its trigger is inside the container', () => {
    first.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);

    NavTooltipDirective.hideWithin(second);
    expect(tooltips()).toHaveLength(1);

    NavTooltipDirective.hideWithin(first.parentElement as HTMLElement);
    expect(tooltips()).toHaveLength(0);
  });

  it('keeps an interactive card open when the pointer leaves a trigger that holds keyboard focus', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();
    const matches = vi.spyOn(first, 'matches').mockImplementation((selector: string) => selector === ':focus-visible');
    first.dispatchEvent(new FocusEvent('focusin'));
    vi.advanceTimersByTime(0);
    expect(tooltips()).toHaveLength(1);

    first.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS);
    expect(tooltips()).toHaveLength(1);

    // ArrowDown still reaches the chips.
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.activeElement?.getAttribute('data-testid')).toBe('nav-tooltip-chip-k8s');
    matches.mockRestore();
  });

  it('still closes the card when keyboard focus moves away (Tab), even while the trigger matches :focus-visible', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();
    const matches = vi.spyOn(first, 'matches').mockImplementation((selector: string) => selector === ':focus-visible');
    first.dispatchEvent(new FocusEvent('focusin'));
    vi.advanceTimersByTime(0);
    expect(tooltips()).toHaveLength(1);

    first.dispatchEvent(new FocusEvent('focusout', { relatedTarget: second }));
    vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS);
    expect(tooltips()).toHaveLength(0);
    matches.mockRestore();
  });

  it('leaves the chip list through the trigger: Shift+Tab lands on it, Tab continues from it', () => {
    host.items.set([
      { key: 'k8s', label: 'Kubernetes' },
      { key: 'cncf', label: 'CNCF' },
    ]);
    TestBed.tick();
    const open = (): void => {
      first.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    };
    const chip = (key: string): HTMLElement => document.body.querySelector<HTMLElement>(`[data-testid="nav-tooltip-chip-${key}"]`) as HTMLElement;

    open();
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    chip('k8s').dispatchEvent(backward);
    expect(document.activeElement).toBe(first);
    expect(backward.defaultPrevented).toBe(true);
    expect(tooltips()).toHaveLength(0);

    open();
    chip('cncf').focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    chip('cncf').dispatchEvent(forward);
    // The browser's own Tab then moves on from the trigger.
    expect(document.activeElement).toBe(first);
    expect(forward.defaultPrevented).toBe(false);
    expect(tooltips()).toHaveLength(0);
  });

  it('holds an interactive card open while the pointer crosses into it', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();
    first.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);

    first.dispatchEvent(new MouseEvent('mouseleave'));
    tooltips()[0].dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS);
    expect(tooltips()).toHaveLength(1);

    tooltips()[0].dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS);
    expect(tooltips()).toHaveLength(0);
  });

  it('closes on Escape', () => {
    first.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(tooltips()).toHaveLength(0);
  });

  it('toggles an interactive card on click so a tap can open it', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();

    first.click();
    expect(tooltips()).toHaveLength(1);

    first.click();
    expect(tooltips()).toHaveLength(0);
  });

  it('stays dismissed after Escape returns focus from a chip to the trigger', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();
    first.click();
    document.body.querySelector<HTMLElement>('[data-testid="nav-tooltip-chip-k8s"]')?.focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.runOnlyPendingTimers();

    expect(tooltips()).toHaveLength(0);
    expect(document.activeElement).toBe(first);
  });

  it('closes a tap-opened card on a pointer press outside it', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();
    first.click();

    tooltips()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(tooltips()).toHaveLength(1);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(tooltips()).toHaveLength(0);
  });

  it('layers the card through the overlay z-index manager', () => {
    first.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);

    expect(Number(tooltips()[0].style.zIndex)).toBeGreaterThan(0);
  });

  it('keeps an interactive card open while one of its chips has focus, whatever the pointer does', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();
    first.click();
    document.body.querySelector<HTMLElement>('[data-testid="nav-tooltip-chip-k8s"]')?.focus();

    first.dispatchEvent(new MouseEvent('mouseleave'));
    tooltips()[0].dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS * 2);

    expect(tooltips()).toHaveLength(1);

    // Hovering another trigger doesn't steal the focused card either.
    second.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);
    expect(tooltips().map((tooltip) => tooltip.getAttribute('role'))).toEqual(['group']);
  });

  it('cancels a pending hide when focus moves into the card during the grace period', () => {
    host.items.set([{ key: 'k8s', label: 'Kubernetes' }]);
    TestBed.tick();
    first.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);

    first.dispatchEvent(new MouseEvent('mouseleave'));
    document.body.querySelector<HTMLElement>('[data-testid="nav-tooltip-chip-k8s"]')?.focus();
    vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS * 2);

    expect(tooltips()).toHaveLength(1);
  });

  describe('right placement (the collapsed rail)', () => {
    const viewport = { width: 1280, height: 800 };
    const card = { width: 90, height: 40 };

    beforeEach(() => {
      host.secondPlacement.set('right');
      TestBed.tick();
      vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(viewport.width);
      vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(viewport.height);
      const original = HTMLElement.prototype.getBoundingClientRect;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('lfxn-tooltip') ? new DOMRect(0, 0, card.width, card.height) : original.call(this);
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const showOver = (trigger: DOMRect): HTMLElement => {
      vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(trigger);
      second.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);
      return tooltips()[0];
    };

    it('opens beside the trigger, vertically centred on it', () => {
      const tooltip = showOver(new DOMRect(12, 100, 24, 24));

      expect(tooltip.classList).toContain('lfxn-tooltip--right');
      expect(tooltip.style.left).toBe(`${12 + 24 + NAV_TOOLTIP_RAIL_OFFSET_PX}px`);
      expect(tooltip.style.top).toBe(`${100 + 12 - card.height / 2}px`);
    });

    it('stays inside the viewport for a trigger at its bottom or top edge', () => {
      const low = showOver(new DOMRect(12, viewport.height - 20, 24, 24));
      expect(low.style.top).toBe(`${viewport.height - card.height - NAV_TOOLTIP_OFFSET_PX}px`);
      second.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(NAV_TOOLTIP_HIDE_DELAY_MS);

      const high = showOver(new DOMRect(12, 0, 24, 8));
      expect(high.style.top).toBe(`${NAV_TOOLTIP_OFFSET_PX}px`);
    });
  });
});
