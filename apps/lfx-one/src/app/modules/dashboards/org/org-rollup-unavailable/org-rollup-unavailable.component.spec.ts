// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { OrgRollUpUnavailableComponent } from './org-rollup-unavailable.component';

describe('OrgRollUpUnavailableComponent', () => {
  it('says the page is not available for a roll-up and links to Memberships', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(OrgRollUpUnavailableComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="org-rollup-unavailable-title"]')?.textContent?.trim()).toBe('This page is not available for a roll-up yet');
    const primary = element.querySelector('[data-testid="org-rollup-unavailable-primary"]');
    expect(primary?.textContent).toContain('Go to Memberships');
    expect(primary?.querySelector('a')?.getAttribute('href')).toBe('/org/memberships');
  });
});
