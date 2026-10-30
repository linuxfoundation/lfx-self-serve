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

  it('shows the help text in a tooltip on hover', async () => {
    fixture.componentRef.setInput('help', 'Your membership tier');
    await fixture.whenStable();

    await hover(help());

    expect(tooltip()?.textContent?.trim()).toBe('Your membership tier');
  });
});
