// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UiButtonComponent } from './button.component';

@Component({
  selector: 'lfx-ui-button-test-host',
  imports: [UiButtonComponent],
  template: `<lfx-ui-button [disabled]="true" (click)="save()">Save</lfx-ui-button>`,
})
class DisabledButtonHostComponent {
  public save = vi.fn();
}

describe('UiButtonComponent', () => {
  let fixture: ComponentFixture<UiButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiButtonComponent], providers: [provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(UiButtonComponent);
    await fixture.whenStable();
  });

  function el(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="ui-button"]') as HTMLElement;
  }

  async function set(name: string, value: unknown): Promise<void> {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  }

  it('renders a button of type button by default', () => {
    expect(el().tagName).toBe('BUTTON');
    expect(el().getAttribute('type')).toBe('button');
  });

  it.each([
    ['primary', 'bg-blue-500'],
    ['outline-neutral', 'border-gray-200'],
    ['outline-accent', 'border-blue-300'],
    ['ghost-neutral', 'text-gray-600'],
    ['ghost-accent', 'text-blue-500'],
    ['destructive', 'bg-red-700'],
    ['ghost-destructive', 'text-red-700'],
    ['recording', 'bg-emerald-600'],
  ])('styles the %s variant', async (variant, token) => {
    await set('variant', variant);
    expect(el().className).toContain(token);
  });

  it.each([
    ['primary', true],
    ['outline-neutral', false],
    ['outline-accent', false],
    ['ghost-neutral', true],
  ])('gives the %s variant a transparent border: %s', async (variant, transparent) => {
    await set('variant', variant);
    expect(el().classList.contains('border-transparent')).toBe(transparent);
  });

  it.each([
    ['sm', 'h-[24px]', 'rounded-[8px]'],
    ['md', 'h-[32px]', 'rounded-[12px]'],
    ['lg', 'h-[40px]', 'rounded-[16px]'],
  ])('sizes %s to %s with a %s radius', async (size, height, radius) => {
    await set('size', size);
    expect(el().className).toContain(height);
    expect(el().className).toContain(radius);
  });

  it('renders the leading icon before the label', async () => {
    await set('icon', 'fa-light fa-plus');
    const icon = el().querySelector('i');
    expect(icon?.className).toBe('fa-light fa-plus');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the trailing icon after the label, independent of the leading icon', async () => {
    await set('icon', 'fa-light fa-video');
    await set('trailingIcon', 'fa-light fa-chevron-right');
    const icons = el().querySelectorAll('i');
    expect(icons).toHaveLength(2);
    expect(icons[1].classList).toContain('fa-chevron-right');
    expect(icons[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('ignores the trailing icon on an icon-only button', async () => {
    await set('iconOnly', true);
    await set('icon', 'fa-light fa-angle-right');
    await set('trailingIcon', 'fa-light fa-chevron-right');
    expect(el().querySelectorAll('i')).toHaveLength(1);
  });

  it('makes an icon-only button square and names it', async () => {
    await set('iconOnly', true);
    await set('ariaLabel', 'Next');
    expect(el().className).toContain('w-[32px]');
    expect(el().getAttribute('aria-label')).toBe('Next');
  });

  it('disables the native button', async () => {
    await set('disabled', true);
    expect((el() as HTMLButtonElement).disabled).toBe(true);
  });

  it('turns off pointer events on the host so a consumer click handler cannot fire', async () => {
    const host = TestBed.createComponent(DisabledButtonHostComponent);
    await host.whenStable();
    const button = host.nativeElement.querySelector('lfx-ui-button') as HTMLElement;
    // jsdom ignores CSS pointer-events, so assert the host class that blocks the click in a browser.
    expect(button.classList).toContain('pointer-events-none');
  });

  it('does not navigate when a disabled link is clicked', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    await set('link', '/meetings');
    await set('disabled', true);
    el().click();
    await fixture.whenStable();

    expect(navigate).not.toHaveBeenCalled();
    expect(el().getAttribute('href')).toBeNull();
  });

  it('warns in dev mode when an icon-only button has no accessible name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await set('iconOnly', true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stretches to full width', async () => {
    await set('fullWidth', true);
    expect(el().className).toContain('w-full');
    expect((fixture.nativeElement as HTMLElement).classList).toContain('block');
  });

  it('renders a router link when link is set', async () => {
    await set('link', '/meetings/create');
    expect(el().tagName).toBe('A');
    expect(el().getAttribute('href')).toBe('/meetings/create');
  });

  it('marks a disabled link as aria-disabled and out of the tab order', async () => {
    await set('link', '/meetings');
    await set('disabled', true);
    expect(el().getAttribute('aria-disabled')).toBe('true');
    expect(el().getAttribute('tabindex')).toBe('-1');
  });
});
