// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ACCOUNT_SETTINGS_NAV } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { AccountLandingComponent } from './account-landing.component';

describe('AccountLandingComponent', () => {
  const render = (): HTMLElement => {
    const fixture = TestBed.configureTestingModule({ imports: [AccountLandingComponent], providers: [provideRouter([])] }).createComponent(
      AccountLandingComponent
    );
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('lists the Account and Settings groups, each named by its heading', () => {
    const root = render();

    for (const group of ACCOUNT_SETTINGS_NAV) {
      const section = root.querySelector(`[data-testid="account-landing-group-${group.id}"]`)!;
      expect(section.getAttribute('aria-labelledby')).toBe(`account-landing-${group.id}`);
      expect(root.querySelector(`#account-landing-${group.id}`)?.textContent?.trim()).toBe(group.label);
    }
  });

  it('links every page with its label and description', () => {
    const root = render();
    const row = root.querySelector('[data-testid="account-landing-row-identities"]')!;

    expect(row.getAttribute('href')).toBe('/identities');
    expect(row.textContent).toContain('Identities');
    expect(row.textContent).toContain('GitHub, GitLab, social and email identities linked to your work.');
    expect(root.querySelectorAll('[data-testid^="account-landing-row-"]').length).toBe(10);
  });
});
