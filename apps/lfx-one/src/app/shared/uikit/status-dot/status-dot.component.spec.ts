// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiStatusDotComponent } from './status-dot.component';

describe('UiStatusDotComponent', () => {
  let fixture: ComponentFixture<UiStatusDotComponent>;
  let host: HTMLElement;

  const marker = () => host.querySelector('[data-testid="ui-status-dot-marker"]') as HTMLElement;
  const label = () => host.querySelector('[data-testid="ui-status-dot-label"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiStatusDotComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiStatusDotComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('status', 'ready');
    await fixture.whenStable();
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

  it('dot-only drops the word and becomes a named image with a tooltip', async () => {
    fixture.componentRef.setInput('dotOnly', true);
    await fixture.whenStable();

    expect(label()).toBeNull();
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Ready');
    expect(host.getAttribute('title')).toBe('Ready');
    expect(host.getAttribute('tabindex')).toBe('0');
    expect(host.className).toContain('focus-visible:shadow-focus');
    expect(host.className).not.toContain('gap-[8px]');
  });
});
