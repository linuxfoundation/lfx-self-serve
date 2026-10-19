// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NAV_TOOLTIP_HIDE_DELAY_MS, NAV_TOOLTIP_SHOW_DELAY_MS } from '@lfx-one/shared/constants';
import type { NavTooltipItem } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavTooltipDirective } from './nav-tooltip.directive';

@Component({
  selector: 'lfx-nav-tooltip-test-host',
  imports: [NavTooltipDirective],
  template: `<button type="button" data-testid="first" lfxNavTooltip="First" [lfxNavTooltipItems]="items()" (lfxNavTooltipItemSelected)="selected.set($event)">
      First</button
    ><button type="button" data-testid="second" lfxNavTooltip="Second">Second</button>`,
})
class HostComponent {
  public readonly items = signal<NavTooltipItem[]>([]);
  public readonly selected = signal<NavTooltipItem | null>(null);
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

  it('shows a label-only tooltip after the hover delay and removes it on leave', () => {
    first.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tooltips()).toHaveLength(0);

    vi.advanceTimersByTime(NAV_TOOLTIP_SHOW_DELAY_MS);
    expect(tooltips()).toHaveLength(1);
    expect(tooltips()[0].textContent).toBe('First');
    expect(tooltips()[0].getAttribute('aria-hidden')).toBe('true');

    first.dispatchEvent(new MouseEvent('mouseleave'));
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
});
