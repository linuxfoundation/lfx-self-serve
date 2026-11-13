// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent (compact)', () => {
  let fixture: ComponentFixture<EmptyStateComponent>;

  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EmptyStateComponent] }).compileComponents();
    fixture = TestBed.createComponent(EmptyStateComponent);
    fixture.componentRef.setInput('variant', 'compact');
    fixture.componentRef.setInput('icon', 'fa-light fa-ticket');
    fixture.componentRef.setInput('title', 'No results found');
    fixture.componentRef.setInput('subtitle', 'Try adjusting your filter criteria');
    await fixture.whenStable();
  });

  // The design's compact empty state: 180px tall, centred, 8px apart, a 44px icon tile over a heading and a sentence.
  it('lays out the icon tile, heading and text at the design’s sizes', () => {
    const box = query('empty-state-compact') as HTMLElement;

    for (const cls of ['min-h-[180px]', 'gap-[8px]', 'items-center', 'justify-center']) expect(box.className).toContain(cls);
    expect(box.querySelector('span')?.className).toContain('h-[44px]');
    expect(box.querySelector('h3')?.textContent?.trim()).toBe('No results found');
    expect(box.querySelector('p')?.textContent?.trim()).toBe('Try adjusting your filter criteria');
  });

  it('offers no reset unless asked', () => {
    expect(query('empty-state-reset-filters')).toBeNull();
  });

  it('offers a large tertiary-accent Reset filters that reports the click', async () => {
    const reset = vi.fn();
    fixture.componentInstance.resetFilters.subscribe(reset);
    fixture.componentRef.setInput('resettable', true);
    await fixture.whenStable();

    const button = query('empty-state-reset-filters') as HTMLElement;
    expect(button.textContent?.trim()).toBe('Reset filters');
    expect(button.querySelector('i')?.className).toContain('fa-arrow-rotate-left');
    button.querySelector('button')?.click();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
