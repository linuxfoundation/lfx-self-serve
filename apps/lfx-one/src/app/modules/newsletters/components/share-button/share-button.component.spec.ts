// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareButtonComponent } from './share-button.component';

describe('ShareButtonComponent', () => {
  let fixture: ComponentFixture<ShareButtonComponent>;

  const button = (): HTMLButtonElement => fixture.nativeElement.querySelector('[data-testid="newsletter-share-button"]');
  const count = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="newsletter-share-button-count"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ShareButtonComponent] }).compileComponents();
    fixture = TestBed.createComponent(ShareButtonComponent);
  });

  it.each([null, 0])('shows just "Share" when the count is %s', (value) => {
    fixture.componentRef.setInput('count', value);
    fixture.detectChanges();
    expect(count()).toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Share');
  });

  it('shows the formatted count and announces it', () => {
    fixture.componentRef.setInput('count', 1234);
    fixture.detectChanges();
    expect(count()!.textContent!.trim()).toBe('· 1,234');
    expect(button().getAttribute('aria-label')).toBe('Share, shared 1,234 times');
  });

  it('emits share on click', () => {
    fixture.detectChanges();
    const share = vi.fn();
    fixture.componentInstance.share.subscribe(share);
    button().click();
    expect(share).toHaveBeenCalledTimes(1);
  });
});
