// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedditSubCountryGeoComponent } from './reddit-subcountry-geo.component';

// The rules (id shapes, excluded countries, the cap, labels) are tested in `campaign-reddit-subcountry-geo.utils.spec.ts`; this tests the wiring.
describe('RedditSubCountryGeoComponent', () => {
  let fixture: ComponentFixture<RedditSubCountryGeoComponent>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  // The protected handler, reached the way the template reaches it.
  const add = (value: string): void => {
    (fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => void>)['onAdd'](value, {
      writeValue: vi.fn(),
    } as unknown as UiComboboxComponent);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RedditSubCountryGeoComponent] }).compileComponents();
    fixture = TestBed.createComponent(RedditSubCountryGeoComponent);
    fixture.componentRef.setInput('locations', []);
    fixture.componentRef.setInput('excludedGeoTargets', ['CA']);
    fixture.detectChanges();
  });

  it('adds a typed id as a labelled chip, refuses one inside an excluded country, and removes one', () => {
    add(' us-ca ');
    expect(fixture.componentInstance.locations()).toEqual(['US-CA']);
    expect(query('reddit-subcountry-geo-US-CA')?.textContent).toContain('US-CA (region)');

    add('CA:6167865');
    expect(query('reddit-subcountry-geo-add-error')?.textContent).toContain('CA is excluded');
    expect(fixture.componentInstance.locations()).toEqual(['US-CA']);

    query('reddit-subcountry-geo-remove-US-CA')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.locations()).toEqual([]);
    expect(query('reddit-subcountry-geo-add-error')).toBeNull();
  });
});
