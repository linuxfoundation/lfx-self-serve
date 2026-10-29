// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiAvatarComponent } from './avatar.component';

@Component({
  selector: 'lfx-ui-avatar-test-host',
  imports: [UiAvatarComponent],
  template: `<lfx-ui-avatar name="Maria Santos" placeholder />`,
})
class TestHostComponent {}

describe('UiAvatarComponent', () => {
  let fixture: ComponentFixture<UiAvatarComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiAvatarComponent, TestHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiAvatarComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('name', 'Maria Santos');
    await fixture.whenStable();
  });

  const initials = () => host.querySelector('[data-testid="ui-avatar-initials"]')?.textContent?.trim();

  it('is a 32px neutral circle with a hairline ring by default', () => {
    expect(host.style.width).toBe('32px');
    expect(host.style.height).toBe('32px');
    expect(host.className).toContain('rounded-ui-full');
    expect(host.className).toContain('bg-ui-neutral-50');
    expect(host.className).toContain('text-ui-neutral-600');
    expect(host.className).toContain('edge');
  });

  it('is an image named by the literal name', () => {
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Maria Santos');
    expect(host.getAttribute('title')).toBe('Maria Santos');
    expect(host.getAttribute('aria-hidden')).toBeNull();
  });

  it('derives two initials from the first two words', () => {
    expect(initials()).toBe('MS');
  });

  it('takes the first two letters of a single word', async () => {
    fixture.componentRef.setInput('name', 'octocat');
    await fixture.whenStable();

    expect(initials()).toBe('OC');
  });

  it('takes initials by code point, not by UTF-16 unit', async () => {
    fixture.componentRef.setInput('name', '😀 Zed');
    await fixture.whenStable();
    expect(initials()).toBe('😀Z');

    fixture.componentRef.setInput('name', '😀😎');
    await fixture.whenStable();
    expect(initials()).toBe('😀😎');
  });

  it('uses the initials override', async () => {
    fixture.componentRef.setInput('initials', '+14');
    await fixture.whenStable();

    expect(initials()).toBe('+14');
    expect(parseFloat(host.style.fontSize)).toBeCloseTo(10.24, 2);
  });

  it('scales the text to 38% of the size', async () => {
    fixture.componentRef.setInput('size', 48);
    await fixture.whenStable();

    expect(parseFloat(host.style.fontSize)).toBeCloseTo(18.24, 2);
  });

  it.each([
    ['accent', 'bg-ui-accent-600'],
    ['feature', 'bg-ui-feature-600'],
    ['success', 'bg-ui-success-600'],
    ['warning', 'bg-ui-warning-600'],
    ['danger', 'bg-ui-danger-600'],
  ] as const)('tints the %s tone with %s, white text and no hairline', async (tone, fill) => {
    fixture.componentRef.setInput('tone', tone);
    await fixture.whenStable();

    expect(host.className).toContain(fill);
    expect(host.className).toContain('text-white');
    expect(host.className).not.toContain('edge');
  });

  it('has 8px corners in the rounded shape', async () => {
    fixture.componentRef.setInput('shape', 'rounded');
    await fixture.whenStable();

    expect(host.className).toContain('rounded-[8px]');
    expect(host.className).not.toContain('rounded-ui-full');
  });

  it('shows the photo and hides the initials', async () => {
    fixture.componentRef.setInput('src', 'https://example.com/maria.png');
    await fixture.whenStable();

    const img = host.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/maria.png');
    expect(img?.getAttribute('alt')).toBe('');
    expect(initials()).toBeUndefined();
  });

  it('falls back to the initials when the photo fails to load', async () => {
    fixture.componentRef.setInput('src', 'https://example.com/broken.png');
    await fixture.whenStable();

    host.querySelector('img')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(host.querySelector('img')).toBeNull();
    expect(initials()).toBe('MS');
  });

  it('tries a new photo after the old one failed', async () => {
    fixture.componentRef.setInput('src', 'https://example.com/broken.png');
    await fixture.whenStable();
    host.querySelector('img')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    fixture.componentRef.setInput('src', 'https://example.com/fixed.png');
    await fixture.whenStable();

    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://example.com/fixed.png');
  });

  it('keys the failure to the URL, so a new photo gets its own load and the failed one stays hidden', async () => {
    fixture.componentRef.setInput('src', 'https://example.com/broken.png');
    await fixture.whenStable();
    host.querySelector('img')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(initials()).toBe('MS');

    fixture.componentRef.setInput('src', 'https://example.com/fixed.png');
    await fixture.whenStable();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://example.com/fixed.png');

    fixture.componentRef.setInput('src', 'https://example.com/broken.png');
    await fixture.whenStable();
    expect(host.querySelector('img')).toBeNull();
    expect(initials()).toBe('MS');
  });

  it('shows the icon instead of the initials when there is no photo', async () => {
    fixture.componentRef.setInput('icon', 'fa-light fa-cube');
    await fixture.whenStable();

    expect(host.querySelector('[data-testid="ui-avatar-icon"]')?.classList.contains('fa-cube')).toBe(true);
    expect(initials()).toBeUndefined();
  });

  it('pins the provider badge at 26% of the size', async () => {
    expect(host.querySelector('[data-testid="ui-avatar-badge"]')).toBeNull();

    fixture.componentRef.setInput('badgeIcon', 'fa-brands fa-github');
    await fixture.whenStable();

    const badge = host.querySelector<HTMLElement>('[data-testid="ui-avatar-badge"]');
    expect(parseFloat(badge?.style.fontSize ?? '0')).toBeCloseTo(8.32, 2);
    expect(badge?.querySelector('i')?.classList.contains('fa-github')).toBe(true);
  });

  it('renders a hidden shimmer shell as a placeholder', async () => {
    fixture.componentRef.setInput('placeholder', true);
    await fixture.whenStable();

    expect(host.className).toContain('avatar-shimmer');
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.getAttribute('role')).toBeNull();
    expect(host.textContent?.trim()).toBe('');
  });

  it('turns placeholder on from a bare attribute', async () => {
    const hosted = TestBed.createComponent(TestHostComponent);
    await hosted.whenStable();

    const avatar = (hosted.nativeElement as HTMLElement).querySelector('lfx-ui-avatar');
    expect(avatar?.className).toContain('avatar-shimmer');
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
  });

  it('hides a decorative avatar from assistive technology', async () => {
    fixture.componentRef.setInput('decorative', true);
    await fixture.whenStable();

    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.getAttribute('role')).toBeNull();
    expect(host.getAttribute('aria-label')).toBeNull();
  });

  it('swaps the hairline for a background ring when stacked', async () => {
    fixture.componentRef.setInput('stacked', true);
    await fixture.whenStable();

    expect(host.className).toContain('ring-ui-background-100');
    expect(host.className).not.toContain('edge');
  });

  describe('after hydration', () => {
    const completeDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const decodeDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');

    const stubImage = (decode: () => Promise<void>) => {
      Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
      Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode });
    };

    const render = async (): Promise<HTMLElement> => {
      const hydrated = TestBed.createComponent(UiAvatarComponent);
      hydrated.componentRef.setInput('name', 'Maria Santos');
      hydrated.componentRef.setInput('src', 'https://example.com/maria.svg');
      await hydrated.whenStable();
      await Promise.resolve();
      await hydrated.whenStable();
      return hydrated.nativeElement as HTMLElement;
    };

    afterEach(() => {
      const restore = (key: string, descriptor?: PropertyDescriptor) =>
        descriptor ? Object.defineProperty(HTMLImageElement.prototype, key, descriptor) : Reflect.deleteProperty(HTMLImageElement.prototype, key);
      restore('complete', completeDescriptor);
      restore('decode', decodeDescriptor);
    });

    it('keeps an already loaded photo that decodes', async () => {
      const decode = vi.fn().mockResolvedValue(undefined);
      stubImage(decode);

      const el = await render();

      expect(decode).toHaveBeenCalledTimes(1);
      expect(el.querySelector('img')).not.toBeNull();
    });

    it('falls back to the initials only when the decode rejects', async () => {
      stubImage(vi.fn().mockRejectedValue(new Error('broken')));

      const el = await render();

      expect(el.querySelector('img')).toBeNull();
      expect(el.querySelector('[data-testid="ui-avatar-initials"]')?.textContent?.trim()).toBe('MS');
    });

    it('ignores a decode that the src changed under, so the first photo can still load later', async () => {
      let reject: (reason: Error) => void = () => undefined;
      stubImage(() => new Promise<void>((_, rej) => (reject = rej)));
      const hydrated = TestBed.createComponent(UiAvatarComponent);
      const el = hydrated.nativeElement as HTMLElement;
      hydrated.componentRef.setInput('name', 'Maria Santos');
      hydrated.componentRef.setInput('src', 'https://example.com/a.png');
      await hydrated.whenStable();

      hydrated.componentRef.setInput('src', 'https://example.com/b.png');
      await hydrated.whenStable();
      reject(new Error('superseded'));
      await Promise.resolve();
      await hydrated.whenStable();

      hydrated.componentRef.setInput('src', 'https://example.com/a.png');
      await hydrated.whenStable();
      expect(el.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
    });
  });
});
