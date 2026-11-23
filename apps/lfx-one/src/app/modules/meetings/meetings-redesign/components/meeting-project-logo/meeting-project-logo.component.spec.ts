// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingProjectLogoComponent } from './meeting-project-logo.component';

describe('MeetingProjectLogoComponent', () => {
  const render = async (src?: string): Promise<ComponentFixture<MeetingProjectLogoComponent>> => {
    const fixture = TestBed.createComponent(MeetingProjectLogoComponent);
    if (src !== undefined) fixture.componentRef.setInput('src', src);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingProjectLogoComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('is a hidden 16px white tile with a 1px neutral ring and 5px corners', async () => {
    const fixture = await render();
    const host: HTMLElement = fixture.nativeElement;

    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(host.classList)).toEqual(expect.arrayContaining(['h-[16px]', 'w-[16px]', 'rounded-[5px]', 'bg-white', 'ring-1', 'ring-gray-200']));
  });

  it('shows a neutral layer-group glyph and no initial without a logo', async () => {
    const fixture = await render('');
    const glyph = query(fixture, 'meetings-home-project-logo-placeholder');

    expect(Array.from(glyph?.classList ?? [])).toEqual(expect.arrayContaining(['fa-layer-group', 'text-[8px]', 'text-gray-500']));
    expect(fixture.nativeElement.textContent.trim()).toBe('');
    expect(query(fixture, 'meetings-home-project-logo-image')).toBeNull();
  });

  it('shows the logo, and falls back to the glyph when it fails to load', async () => {
    const fixture = await render('https://cdn.example/logo.svg');
    const img = query(fixture, 'meetings-home-project-logo-image');

    expect(img?.getAttribute('src')).toBe('https://cdn.example/logo.svg');
    expect(img?.getAttribute('alt')).toBe('');

    img?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(query(fixture, 'meetings-home-project-logo-image')).toBeNull();
    expect(query(fixture, 'meetings-home-project-logo-placeholder')).not.toBeNull();
  });

  describe('after hydration', () => {
    const completeDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const decodeDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');

    afterEach(() => {
      const restore = (key: string, descriptor: PropertyDescriptor | undefined): unknown =>
        descriptor ? Object.defineProperty(HTMLImageElement.prototype, key, descriptor) : Reflect.deleteProperty(HTMLImageElement.prototype, key);
      restore('complete', completeDescriptor);
      restore('decode', decodeDescriptor);
    });

    it('falls back to the glyph when an already loaded logo fails to decode', async () => {
      Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
      Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockRejectedValue(new Error('broken')) });
      const fixture = await render('https://cdn.example/broken.svg');
      await Promise.resolve();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query(fixture, 'meetings-home-project-logo-image')).toBeNull();
      expect(query(fixture, 'meetings-home-project-logo-placeholder')).not.toBeNull();
    });
  });
});
