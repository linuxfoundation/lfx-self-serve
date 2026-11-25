// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { INSIGHTS_TOKEN_ELIGIBLE, INSIGHTS_TOKEN_INELIGIBLE } from '@lfx-one/shared/constants';
import { CreateInsightsTokenResponse, InsightsToken, InsightsTokenEligibility } from '@lfx-one/shared/interfaces';
import { InsightsTokensService } from '@services/insights-tokens.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountInsightsTokensComponent } from './account-insights-tokens.component';
import { AccountRevokeTokenDialogComponent } from './revoke-dialog/account-revoke-token-dialog.component';
import { AccountInsightsTokenDialogComponent } from './token-dialog/account-insights-token-dialog.component';
import { AccountInsightsTokenDialogRef } from './token-dialog/account-insights-token-dialog-ref';

const token = (uid: string, expiresAt: string | null = null): InsightsToken => ({
  uid,
  name: `Report ${uid}`,
  lookupId: `look${uid}`,
  createdAt: '2026-01-02T00:00:00Z',
  lastUsedAt: null,
  expiresAt,
});

/** State-only card: no template, so these tests cost no render. Providers are not inherited, so the card's own is repeated. */
@Component({ selector: 'lfx-test-account-insights-tokens', template: '', providers: [DialogService] })
class StateTokensComponent extends AccountInsightsTokensComponent {}

describe('AccountInsightsTokensComponent', () => {
  interface DialogOverrides {
    providers?: (ref: { close: () => void }) => { provide: unknown; useValue: unknown }[];
  }

  function setup(tokens: InsightsToken[] = [], eligibility: InsightsTokenEligibility = INSIGHTS_TOKEN_ELIGIBLE) {
    const closed = new Subject<unknown>();
    const close = vi.fn(() => closed.next(undefined));
    const open = vi.fn<(content: unknown, config: unknown, overrides?: DialogOverrides) => { closed: Subject<unknown>; close: () => void }>(() => ({
      closed,
      close,
    }));
    const revokeToken = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: InsightsTokensService, useValue: { getEligibility: () => of(eligibility), getTokens: () => of(tokens), revokeToken } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ConfirmationService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn(), messageObserver: of(), clearObserver: of() } },
        { provide: UiModalService, useValue: { open } },
      ],
    });
    return { open, closed, close, revokeToken };
  }

  it('adds a token created in the dialog, once the dialog closes', async () => {
    const { open, closed } = setup();
    const fixture = TestBed.createComponent(StateTokensComponent);
    await fixture.whenStable();

    fixture.componentInstance['openCreateDialog']();
    const [content, config, overrides] = open.mock.calls[0];
    expect(content).toBe(AccountInsightsTokenDialogComponent);
    expect(config).toMatchObject({ closeOnEscape: false, closeOnBackdropClick: false });
    const providers = overrides?.providers?.({ close: vi.fn() }) ?? [];
    const steps = providers.find((provider) => provider.provide === AccountInsightsTokenDialogRef)?.useValue as AccountInsightsTokenDialogRef;
    expect(providers.find((provider) => provider.provide === DynamicDialogRef)?.useValue).toBe(steps);

    const created: CreateInsightsTokenResponse = { token: token('new'), secret: 'lfi_secret' };
    steps.close(created);
    closed.next(undefined);

    expect(fixture.componentInstance['tokens']().map((t) => t.uid)).toEqual(['new']);
  });

  it('asks before revoking, and revokes only on yes', async () => {
    const { open, closed, revokeToken } = setup([token('t1')]);
    const fixture = TestBed.createComponent(StateTokensComponent);
    await fixture.whenStable();

    fixture.componentInstance['confirmRevoke'](token('t1'));
    expect(open).toHaveBeenCalledWith(
      AccountRevokeTokenDialogComponent,
      expect.objectContaining({ data: { name: 'Report t1' }, role: 'alertdialog', describedBy: true })
    );
    closed.next(true);

    expect(revokeToken).toHaveBeenCalledWith('t1');
  });

  it('closes the revoke dialog with the card, and revokes nothing', async () => {
    const { close, revokeToken } = setup([token('t1')]);
    const fixture = TestBed.createComponent(StateTokensComponent);
    await fixture.whenStable();

    fixture.componentInstance['confirmRevoke'](token('t1'));
    fixture.destroy();

    expect(close).toHaveBeenCalled();
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it('lists tokens with Revoke, or Remove once expired, and offers a new one', async () => {
    setup([token('t1'), token('old', '2020-01-01T00:00:00Z')]);
    const fixture = TestBed.createComponent(AccountInsightsTokensComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="account-insights-tokens-revoke-t1"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="account-insights-tokens-remove-old"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="account-insights-tokens-new"]')).not.toBeNull();
  });

  it('starts with an empty state that offers a new token', async () => {
    setup([]);
    const fixture = TestBed.createComponent(AccountInsightsTokensComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="account-insights-tokens-empty"]')?.textContent).toContain('No LFX Insights API tokens yet');
    expect(host.querySelector('[data-testid="account-insights-tokens-empty-new"]')).not.toBeNull();
  });

  it('says when the account isn’t enabled yet', async () => {
    setup([], INSIGHTS_TOKEN_INELIGIBLE);
    const fixture = TestBed.createComponent(AccountInsightsTokensComponent);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="account-insights-tokens-locked"]')).not.toBeNull();
  });
});

describe('AccountRevokeTokenDialogComponent', () => {
  it('names the token and revokes it on “Revoke token”', async () => {
    const close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DialogRef, useValue: { close, id: 'revoke' } },
        { provide: DIALOG_DATA, useValue: { name: 'Quarterly report' } },
      ],
    });
    const fixture = TestBed.createComponent(AccountRevokeTokenDialogComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const text = host.querySelector('[data-testid="account-revoke-token-text"]');

    expect(text?.textContent).toContain('Anything using Quarterly report will lose access');
    expect(text?.id).toBe('revoke-subtitle');
    (host.querySelector('[data-testid="account-revoke-token-confirm"] button') as HTMLButtonElement).click();
    expect(close).toHaveBeenCalledWith(true);
  });
});
