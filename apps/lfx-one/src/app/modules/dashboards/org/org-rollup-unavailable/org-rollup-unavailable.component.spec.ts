// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { describe, expect, it, vi } from 'vitest';

import { OrgRollUpUnavailableComponent } from './org-rollup-unavailable.component';

describe('OrgRollUpUnavailableComponent', () => {
  // A shared link must keep the family, so the button names the roll-up's own Memberships, not the legacy form.
  it("says the page is not available for a roll-up and links to the roll-up's own Memberships", () => {
    const orgLensLink = vi.fn((page: string) => ['/org', 'family-0014100000RootAAAA', page]);
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: OrgLensNavigationService, useValue: { orgLensLink } }] });
    const fixture = TestBed.createComponent(OrgRollUpUnavailableComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="org-rollup-unavailable-title"]')?.textContent?.trim()).toBe('This page is not available for a roll-up yet');
    const primary = element.querySelector('[data-testid="org-rollup-unavailable-primary"]');
    expect(primary?.textContent).toContain('Go to Memberships');
    expect(primary?.querySelector('a')?.getAttribute('href')).toBe('/org/family-0014100000RootAAAA/memberships');
    expect(orgLensLink).toHaveBeenCalledWith('memberships');
  });
});
