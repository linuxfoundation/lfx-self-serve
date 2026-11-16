// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { NewsletterEngagementRailComponent } from './newsletter-engagement-rail.component';

describe('NewsletterEngagementRailComponent', () => {
  let fixture: ComponentFixture<NewsletterEngagementRailComponent>;
  let el: HTMLElement;

  function render(inputs: { views?: number | null; shares?: number | null }): void {
    fixture = TestBed.createComponent(NewsletterEngagementRailComponent);
    fixture.componentRef.setInput('testId', 'rail');
    if (inputs.views !== undefined) fixture.componentRef.setInput('views', inputs.views);
    if (inputs.shares !== undefined) fixture.componentRef.setInput('shares', inputs.shares);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const byTestId = (id: string) => el.querySelector(`[data-testid="${id}"]`);

  it('shows views and shares with grouped counts and accessible labels', () => {
    render({ views: 12_500, shares: 3 });

    expect(byTestId('rail-views-count')!.textContent!.trim()).toBe('12,500');
    expect(byTestId('rail-views')!.getAttribute('aria-label')).toBe('Viewed 12,500 times');
    expect(byTestId('rail-share-count')!.textContent!.trim()).toBe('3');
    expect(byTestId('rail-share')!.getAttribute('aria-label')).toBe('Share, shared 3 times');
  });

  it('hides views while unknown but shows a real zero', () => {
    render({ views: null });
    expect(byTestId('rail-views')).toBeNull();

    render({ views: 0 });
    expect(byTestId('rail-views-count')!.textContent!.trim()).toBe('0');
  });

  it('hides the share count while unknown or zero', () => {
    render({ shares: 0 });
    expect(byTestId('rail-share-count')).toBeNull();
    expect(byTestId('rail-share')!.getAttribute('aria-label')).toBe('Share');
  });

  it('uses singular labels for one view and one share', () => {
    render({ views: 1, shares: 1 });
    expect(byTestId('rail-views')!.getAttribute('aria-label')).toBe('Viewed 1 time');
    expect(byTestId('rail-share')!.getAttribute('aria-label')).toBe('Share, shared 1 time');
  });

  it('emits share when the Share button is clicked', () => {
    render({ shares: 2 });
    const emitted = vi.fn();
    fixture.componentInstance.share.subscribe(emitted);

    (byTestId('rail-share') as HTMLButtonElement).click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });
});
