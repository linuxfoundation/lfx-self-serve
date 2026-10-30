// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiDescriptionComponent } from './description.component';

describe('UiDescriptionComponent', () => {
  let fixture: ComponentFixture<UiDescriptionComponent>;
  let host: HTMLElement;

  const list = () => host.querySelector('[data-testid="ui-description-list"]') as HTMLElement;
  const label = () => host.querySelector('[data-testid="ui-description-label"]') as HTMLElement;
  const value = () => host.querySelector('[data-testid="ui-description-value"]') as HTMLElement;
  const help = () => host.querySelector('[data-testid="ui-description-help"]');

  const tooltip = () => TestBed.inject(OverlayContainer).getContainerElement().querySelector('[data-testid="ui-tooltip"]');
  // Attach the host so the tooltip can position, then hover with only the timers faked.
  const hover = async (target: Element | null): Promise<void> => {
    document.body.appendChild(host);
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    target?.dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }));
    await vi.advanceTimersByTimeAsync(400);
  };

  // A Tab keydown first, so the focus counts as keyboard focus and opens the tooltip.
  const focusByKeyboard = async (target: Element | null): Promise<void> => {
    document.body.appendChild(host);
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    (target as HTMLElement).focus();
    await vi.advanceTimersByTimeAsync(400);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiDescriptionComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiDescriptionComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('label', 'Region');
    fixture.componentRef.setInput('value', 'Europe (Lisbon)');
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    host.remove();
  });

  it('renders a definition list with the title and the value', () => {
    expect(list().tagName).toBe('DL');
    expect(label().tagName).toBe('DT');
    expect(value().tagName).toBe('DD');
    expect(label().textContent?.trim()).toBe('Region');
    expect(value().textContent?.trim()).toBe('Europe (Lisbon)');
  });

  it('styles the title and the value with their type roles and colours', () => {
    expect(label().className).toContain('label-14');
    expect(label().className).toContain('font-medium');
    expect(label().className).toContain('text-ui-neutral-600');
    expect(value().className).toContain('copy-14');
    expect(value().className).toContain('text-ui-neutral-900');
    expect(list().className).toContain('gap-[4px]');
    expect(help()).toBeNull();
  });

  it('right-aligns and uses tabular figures', async () => {
    fixture.componentRef.setInput('align', 'right');
    await fixture.whenStable();

    expect(list().className).toContain('items-end');
    expect(list().className).toContain('text-right');
    expect(value().className).toContain('tabular-nums');
  });

  it('shows no tooltip on a value that is not truncated', async () => {
    expect(value().className).not.toContain('truncate');

    await hover(value());

    expect(tooltip()).toBeNull();
  });

  it('truncates a long value and shows the full value in a tooltip on hover', async () => {
    fixture.componentRef.setInput('ellipsis', true);
    await fixture.whenStable();

    expect(value().className).toContain('truncate');
    expect(value().getAttribute('title')).toBeNull();

    await hover(value());

    expect(tooltip()?.textContent?.trim()).toBe('Europe (Lisbon)');
  });

  it('caps a right-aligned truncated value at the column width', async () => {
    fixture.componentRef.setInput('align', 'right');
    fixture.componentRef.setInput('ellipsis', true);
    await fixture.whenStable();

    expect(value().className).toContain('max-w-full');
    expect(value().className).toContain('truncate');
  });

  it('shows a named help icon after the title', async () => {
    fixture.componentRef.setInput('help', 'Your membership tier');
    await fixture.whenStable();

    expect(help()?.getAttribute('role')).toBe('img');
    expect(help()?.getAttribute('aria-label')).toBe('Your membership tier');
    expect(help()?.getAttribute('title')).toBeNull();
    expect(help()?.className).toContain('fa-circle-question');
  });

  it('makes the help icon keyboard-focusable with a visible focus ring', async () => {
    fixture.componentRef.setInput('help', 'Your membership tier');
    await fixture.whenStable();

    expect(help()?.getAttribute('tabindex')).toBe('0');
    expect(help()?.className).toContain('focus-visible:shadow-focus');
    expect(help()?.className).toContain('rounded-ui-full');
  });

  it('shows the help text in a tooltip on keyboard focus', async () => {
    fixture.componentRef.setInput('help', 'Your membership tier');
    await fixture.whenStable();

    await focusByKeyboard(help());

    expect(document.activeElement).toBe(help());
    expect(tooltip()?.textContent?.trim()).toBe('Your membership tier');
  });

  it('makes a truncated value keyboard-focusable and leaves a plain value out of the tab order', async () => {
    expect(value().getAttribute('tabindex')).toBeNull();

    fixture.componentRef.setInput('ellipsis', true);
    await fixture.whenStable();

    expect(value().getAttribute('tabindex')).toBe('0');
    expect(value().className).toContain('focus-visible:shadow-focus');
  });

  it('names a truncated value by its text so a screen reader does not read it twice', async () => {
    fixture.componentRef.setInput('ellipsis', true);
    await fixture.whenStable();

    expect(value().getAttribute('aria-label')).toBe('Europe (Lisbon)');
    expect(value().getAttribute('aria-describedby')).toBeNull();
  });

  it('shows the full value in a tooltip when a truncated value gets keyboard focus', async () => {
    fixture.componentRef.setInput('ellipsis', true);
    await fixture.whenStable();

    await focusByKeyboard(value());

    expect(document.activeElement).toBe(value());
    expect(tooltip()?.textContent?.trim()).toBe('Europe (Lisbon)');
  });

  it('shows the help text in a tooltip on hover', async () => {
    fixture.componentRef.setInput('help', 'Your membership tier');
    await fixture.whenStable();

    await hover(help());

    expect(tooltip()?.textContent?.trim()).toBe('Your membership tier');
  });
});
