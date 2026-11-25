// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ACCOUNT_DEVELOPER_SETTINGS_COPY } from '@lfx-one/shared/constants';
import { CreateInsightsTokenResponse } from '@lfx-one/shared/interfaces';
import { InsightsTokensService } from '@services/insights-tokens.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountInsightsTokenDialogComponent } from './account-insights-token-dialog.component';
import { AccountInsightsTokenDialogRef } from './account-insights-token-dialog-ref';

const CREATED: CreateInsightsTokenResponse = {
  token: { uid: 'u1', name: 'Quarterly report', lookupId: 'abcd', createdAt: '2026-01-02T00:00:00Z', lastUsedAt: null, expiresAt: null },
  secret: 'lfi_live_secret',
};

describe('AccountInsightsTokenDialogComponent', () => {
  async function render() {
    const cdkClose = vi.fn();
    const steps = new AccountInsightsTokenDialogRef({ close: cdkClose });
    const createToken = vi.fn(() => of(CREATED));
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: AccountInsightsTokenDialogRef, useValue: steps },
        { provide: DynamicDialogRef, useValue: steps },
        { provide: InsightsTokensService, useValue: { createToken } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountInsightsTokenDialogComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    return { fixture, query, cdkClose, createToken };
  }

  it('asks for a name, with the design’s placeholder and hint', async () => {
    const { query } = await render();
    const name = query('account-insights-token-name');

    expect(name?.querySelector('input')?.getAttribute('placeholder')).toBe(ACCOUNT_DEVELOPER_SETTINGS_COPY.namePlaceholder);
    expect(name?.textContent).toContain(ACCOUNT_DEVELOPER_SETTINGS_COPY.nameHint);
    expect(query('account-insights-token-expiration')).not.toBeNull();
  });

  it('shows the new token in the same dialog, with the warning and how to use it', async () => {
    const { fixture, query, cdkClose, createToken } = await render();
    fixture.componentInstance['form'].controls.name.setValue('Quarterly report');
    await fixture.whenStable();

    query('account-insights-token-create')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(createToken).toHaveBeenCalledWith('Quarterly report', expect.any(String));
    expect(cdkClose).not.toHaveBeenCalled();
    expect(query('account-insights-token-warning')?.textContent).toContain(ACCOUNT_DEVELOPER_SETTINGS_COPY.createdWarning);
    expect((query('account-insights-token-secret')?.querySelector('input') as HTMLInputElement).value).toBe('lfi_live_secret');
    expect(query('account-insights-token-secret')?.getAttribute('data-dd-privacy')).toBe('mask');
    expect(query('account-insights-token-usage')?.textContent).toContain('Authorization: Bearer');

    query('account-insights-token-close')?.querySelector('button')?.click();
    expect(cdkClose).toHaveBeenCalled();
  });
});
