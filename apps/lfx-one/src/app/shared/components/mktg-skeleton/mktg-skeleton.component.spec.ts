// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MktgSkeletonComponent } from './mktg-skeleton.component';

describe('MktgSkeletonComponent', () => {
  it.each(['run-page', 'header', 'card', 'rows'] as const)('renders the neutral %s shape with no guessed text', async (variant) => {
    await TestBed.configureTestingModule({ imports: [MktgSkeletonComponent] }).compileComponents();
    const fixture = TestBed.createComponent(MktgSkeletonComponent);
    fixture.componentRef.setInput('variant', variant);
    fixture.componentRef.setInput('rows', 4);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.getAttribute('aria-label')).toBe('Loading');
    expect(host.querySelector(`[data-variant="${variant}"]`)).not.toBeNull();
    expect(host.querySelector('.animate-pulse')).not.toBeNull();
    expect(host.textContent?.trim()).toBe('');
    expect(host.querySelectorAll('[data-testid="mktg-skeleton-row"]')).toHaveLength(variant === 'header' ? 0 : 4);
  });
});
