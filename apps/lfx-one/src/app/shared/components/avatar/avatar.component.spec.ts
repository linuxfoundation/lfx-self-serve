// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AvatarComponent } from './avatar.component';

/**
 * Guards the warm-cache hydration bug where a replayed/duplicate error for a URL the avatar had
 * already swapped away from hid the working fallback image and left the initial showing.
 */
describe('AvatarComponent image errors', () => {
  const primaryUrl = 'https://avatars.example/primary.png';
  const fallbackUrl = 'https://avatars.example/fallback.png';

  let fixture: ComponentFixture<AvatarComponent>;
  let errors: number;
  let now: number;

  beforeEach(async () => {
    // Pin both clocks: jsdom's Event.timeStamp is not guaranteed to share performance.now()'s origin.
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    await TestBed.configureTestingModule({ imports: [AvatarComponent] }).compileComponents();
    fixture = TestBed.createComponent(AvatarComponent);
    errors = 0;
    fixture.componentInstance.onImageError.subscribe(() => errors++);
    fixture.componentRef.setInput('label', 'Jane');
    fixture.componentRef.setInput('image', primaryUrl);
    await fixture.whenStable();
  });

  afterEach(() => vi.restoreAllMocks());

  function img(): HTMLImageElement | null {
    return fixture.nativeElement.querySelector('img');
  }

  async function swapTo(url: string): Promise<void> {
    fixture.componentRef.setInput('image', url);
    await fixture.whenStable();
  }

  async function fireError(target: HTMLImageElement, timeStamp: number): Promise<void> {
    const event = new Event('error');
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    target.dispatchEvent(event);
    await fixture.whenStable();
  }

  it('falls back to the label and emits once on a genuine error', async () => {
    await fireError(img() as HTMLImageElement, now + 1);

    expect(img()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('J');
    expect(errors).toBe(1);
  });

  it('ignores an error on an image that already loaded', async () => {
    const el = img() as HTMLImageElement;
    Object.defineProperty(el, 'complete', { value: true });
    Object.defineProperty(el, 'naturalWidth', { value: 64 });

    await fireError(el, now + 1);

    expect(img()).not.toBeNull();
    expect(errors).toBe(0);
  });

  it('keeps the fallback displayed when an earlier error is delivered after the URL swap', async () => {
    const el = img() as HTMLImageElement;
    await fireError(el, now + 1);
    expect(errors).toBe(1);

    now = 2000;
    await swapTo(fallbackUrl);
    expect(img()?.getAttribute('src')).toBe(fallbackUrl);

    // The replayed error originated before the swap (timeStamp 1500 < 2000).
    await fireError(img() as HTMLImageElement, 1500);

    expect(img()?.getAttribute('src')).toBe(fallbackUrl);
    expect(errors).toBe(1);
  });

  it('still reports a genuine error on the fallback URL after a swap', async () => {
    now = 2000;
    await swapTo(fallbackUrl);

    await fireError(img() as HTMLImageElement, 2500);

    expect(img()).toBeNull();
    expect(errors).toBe(1);
  });
});
