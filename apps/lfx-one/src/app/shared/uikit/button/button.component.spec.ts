// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiButtonComponent } from './button.component';

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
    ['sm', 'h-6'],
    ['md', 'h-8'],
    ['lg', 'h-10'],
  ])('sizes %s to %s', async (size, token) => {
    await set('size', size);
    expect(el().className).toContain(token);
  });

  it('renders the leading icon before the label', async () => {
    await set('icon', 'fa-light fa-plus');
    const icon = el().querySelector('i');
    expect(icon?.className).toBe('fa-light fa-plus');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('makes an icon-only button square and names it', async () => {
    await set('iconOnly', true);
    await set('ariaLabel', 'Next');
    expect(el().className).toContain('w-8');
    expect(el().getAttribute('aria-label')).toBe('Next');
  });

  it('disables the native button', async () => {
    await set('disabled', true);
    expect((el() as HTMLButtonElement).disabled).toBe(true);
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
