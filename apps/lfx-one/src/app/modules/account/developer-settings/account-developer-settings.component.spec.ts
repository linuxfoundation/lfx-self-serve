// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { ACCOUNT_DEVELOPER_SETTINGS_COPY, ACCOUNT_SETTINGS_SECTIONS, INSIGHTS_TOKEN_ELIGIBLE } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@services/feature-flag.service';
import { InsightsTokensService } from '@services/insights-tokens.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountDeveloperSettingsComponent } from './account-developer-settings.component';

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.payload.signature-abcdef';

describe('AccountDeveloperSettingsComponent', () => {
  async function render(token = TOKEN, insightsOn = false) {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { embedded: true, section: ACCOUNT_SETTINGS_SECTIONS.DEVELOPER_SETTINGS } }, fragment: of(null) },
        },
        { provide: UserService, useValue: { impersonating: signal(false), getDeveloperTokenInfo: vi.fn(() => of({ token })) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(insightsOn) } },
        { provide: InsightsTokensService, useValue: { getEligibility: () => of(INSIGHTS_TOKEN_ELIGIBLE), getTokens: () => of([]) } },
        { provide: ConfirmationService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn(), messageObserver: of(), clearObserver: of() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountDeveloperSettingsComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    return { fixture, host, query };
  }

  it('shows the guidelines as a note, and the token masked until shown in its row', async () => {
    const { fixture, query } = await render();

    expect(query('account-developer-settings-guidelines')?.textContent).toContain('Never commit this token to version control.');
    const value = query('account-developer-settings-token-value');
    expect(value?.textContent).not.toContain('signature-abcdef');
    expect(value?.getAttribute('data-dd-privacy')).toBe('mask');

    query('account-developer-settings-token-toggle')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(value?.textContent).toBe(TOKEN);
    expect(query('account-developer-settings-token-toggle')?.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('copies the token from its row', async () => {
    const { fixture, query } = await render();
    const copy = vi.spyOn(fixture.componentInstance, 'copyToken').mockImplementation(() => undefined);

    query('account-developer-settings-token-copy')?.querySelector('button')?.click();

    expect(copy).toHaveBeenCalledWith(TOKEN);
  });

  it('says when the token is unavailable', async () => {
    const { query } = await render('');

    expect(query('account-developer-settings-token-unavailable')).not.toBeNull();
  });

  it('adds the Insights card and its guideline once that API is on', async () => {
    const { query } = await render(TOKEN, true);

    expect(query('account-developer-settings-api-token')?.textContent).toContain(ACCOUNT_DEVELOPER_SETTINGS_COPY.apiTokenSubtitle);
    expect(query('account-developer-settings-guidelines')?.textContent).toContain('its own LFX Insights API token');
    expect(query('account-insights-tokens')).not.toBeNull();
  });
});
