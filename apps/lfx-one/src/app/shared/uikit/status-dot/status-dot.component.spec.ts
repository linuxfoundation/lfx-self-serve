// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiStatusDotComponent } from './status-dot.component';

describe('UiStatusDotComponent', () => {
  let fixture: ComponentFixture<UiStatusDotComponent>;
  let host: HTMLElement;

  const marker = () => host.querySelector('[data-testid="ui-status-dot-marker"]') as HTMLElement;
  const label = () => host.querySelector('[data-testid="ui-status-dot-label"]');

  const image = () => host.querySelector('[data-testid="ui-status-dot-image"]') as HTMLElement;
  const tooltip = () => TestBed.inject(OverlayContainer).getContainerElement().querySelector('[data-testid="ui-tooltip"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiStatusDotComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiStatusDotComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('status', 'ready');
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    host.remove();
  });

  it('shows a 10px decorative dot and the sentence-case word', () => {
    expect(marker().className).toContain('h-[10px]');
    expect(marker().className).toContain('w-[10px]');
    expect(marker().getAttribute('aria-hidden')).toBe('true');
    expect(label()?.textContent?.trim()).toBe('Ready');
    expect(host.getAttribute('role')).toBeNull();
    expect(host.getAttribute('tabindex')).toBeNull();
    expect(host.className).toContain('gap-[8px]');
  });

  it.each([
    ['queued', 'Queued', 'bg-ui-neutral-400', true],
    ['building', 'Building', 'bg-ui-warning-500', true],
    ['ready', 'Ready', 'bg-ui-success-600', false],
    ['error', 'Error', 'bg-ui-danger-600', false],
    ['canceled', 'Canceled', 'bg-ui-neutral-900', false],
    ['deleted', 'Deleted', 'ring-ui-neutral-400', false],
  ] as const)('renders the %s state', async (status, word, dotClass, pulses) => {
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();

    expect(label()?.textContent?.trim()).toBe(word);
    expect(marker().className).toContain(dotClass);
    expect(marker().className.includes('status-dot-pulse')).toBe(pulses);
  });

  it('draws the deleted state as a hollow ring', async () => {
    fixture.componentRef.setInput('status', 'deleted');
    await fixture.whenStable();

    expect(marker().className).toContain('bg-transparent');
    expect(marker().className).toContain('ring-inset');
  });

  it('uses a custom label', async () => {
    fixture.componentRef.setInput('status', 'building');
    fixture.componentRef.setInput('label', 'Running');
    await fixture.whenStable();

    expect(label()?.textContent?.trim()).toBe('Running');
  });

  it('dot-only drops the word and becomes a named, focusable image', async () => {
    fixture.componentRef.setInput('dotOnly', true);
    await fixture.whenStable();

    expect(label()).toBeNull();
    expect(host.getAttribute('role')).toBeNull();
    expect(host.getAttribute('tabindex')).toBeNull();
    expect(host.className).not.toContain('gap-[8px]');
    expect(image().getAttribute('role')).toBe('img');
    expect(image().getAttribute('aria-label')).toBe('Ready');
    expect(image().getAttribute('title')).toBeNull();
    expect(image().getAttribute('tabindex')).toBe('0');
    expect(image().className).toContain('focus-visible:shadow-focus');
    expect(image().contains(marker())).toBe(true);
  });

  it('dot-only shows the word in a tooltip on hover', async () => {
    document.body.appendChild(host);
    fixture.componentRef.setInput('dotOnly', true);
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    expect(tooltip()).toBeNull();
    image().dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }));
    await vi.advanceTimersByTimeAsync(400);

    expect(tooltip()?.textContent?.trim()).toBe('Ready');
  });

  it('dot-only shows the word in a tooltip on keyboard focus', async () => {
    document.body.appendChild(host);
    fixture.componentRef.setInput('dotOnly', true);
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    // A Tab keydown first, so the focus counts as keyboard focus.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    image().focus();
    await vi.advanceTimersByTimeAsync(400);

    expect(document.activeElement).toBe(image());
    expect(tooltip()?.textContent?.trim()).toBe('Ready');
  });

  it('shows no tooltip when the word is visible', async () => {
    document.body.appendChild(host);
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    host.dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }));
    await vi.advanceTimersByTimeAsync(400);

    expect(tooltip()).toBeNull();
  });
});
