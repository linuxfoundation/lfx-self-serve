// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MoreFiltersToggleComponent } from './more-filters-toggle.component';

describe('MoreFiltersToggleComponent', () => {
  let fixture: ComponentFixture<MoreFiltersToggleComponent>;

  const button = (): HTMLButtonElement => fixture.nativeElement.querySelector('[data-testid="page-more-filters-toggle"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MoreFiltersToggleComponent] }).compileComponents();
    fixture = TestBed.createComponent(MoreFiltersToggleComponent);
    fixture.componentRef.setInput('controls', 'page-more-filters');
    fixture.componentRef.setInput('dataTest', 'page-more-filters-toggle');
    await fixture.whenStable();
  });

  it('starts collapsed, as a button that names the row it controls', () => {
    expect(button().tagName).toBe('BUTTON');
    expect(button().getAttribute('type')).toBe('button');
    expect(button().textContent?.trim()).toBe('More filters');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().getAttribute('aria-controls')).toBe('page-more-filters');
    expect(fixture.componentInstance.expanded()).toBe(false);
  });

  it('counts the hidden filters not at their default while collapsed', async () => {
    fixture.componentRef.setInput('count', 2);
    await fixture.whenStable();
    expect(button().textContent?.trim()).toBe('More filters (2)');

    fixture.componentRef.setInput('count', 0);
    await fixture.whenStable();
    expect(button().textContent?.trim()).toBe('More filters');
  });

  it('expands and collapses on a click, which a keyboard Enter or Space on the button also sends', async () => {
    fixture.componentRef.setInput('count', 1);
    button().click();
    await fixture.whenStable();

    expect(fixture.componentInstance.expanded()).toBe(true);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(button().textContent?.trim()).toBe('Fewer filters');

    button().click();
    await fixture.whenStable();

    expect(fixture.componentInstance.expanded()).toBe(false);
    expect(button().textContent?.trim()).toBe('More filters (1)');
  });

  it('follows the page when it sets the expanded state', async () => {
    fixture.componentRef.setInput('expanded', true);
    await fixture.whenStable();

    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(button().textContent?.trim()).toBe('Fewer filters');
  });
});
