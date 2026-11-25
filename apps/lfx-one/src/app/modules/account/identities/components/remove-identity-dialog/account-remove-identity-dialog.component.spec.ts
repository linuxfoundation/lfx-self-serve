// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ConnectedIdentityFull } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

import { AccountRemoveIdentityDialogComponent } from './account-remove-identity-dialog.component';

const IDENTITY = { id: 'g1', provider: 'github', type: 'username', identifier: 'ada', icon: 'fa-brands fa-github', isPrimary: false } as ConnectedIdentityFull;

describe('AccountRemoveIdentityDialogComponent', () => {
  async function render(state: 'verified' | 'unverified') {
    const close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: { identity: { ...IDENTITY, state } } },
      ],
    });
    const fixture = TestBed.createComponent(AccountRemoveIdentityDialogComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    return { fixture, host, query, close };
  }

  it('asks "This is not you?" for an unverified identity and removes it at once', async () => {
    const { host, query, close } = await render('unverified');

    expect(host.querySelector('[data-testid="ui-modal-title"]')?.textContent).toContain('This is not you?');
    expect(query('account-remove-identity-text')?.textContent).toContain('will no longer be attributed to you');
    query('account-remove-identity-confirm')?.querySelector('button')?.click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('removes a verified identity only once the user acknowledges the impact', async () => {
    const { fixture, host, query } = await render('verified');
    const confirm = () => query('account-remove-identity-confirm')?.querySelector('button') as HTMLButtonElement;

    expect(host.querySelector('[data-testid="ui-modal-title"]')?.textContent).toContain('Remove verified identity');
    expect(query('account-remove-identity-text')?.textContent).toContain('ada (GitHub) will be unlinked from your profile.');
    expect(confirm().disabled).toBe(true);

    (query('account-remove-identity-acknowledge')?.querySelector('input') as HTMLInputElement).click();
    await fixture.whenStable();
    expect(confirm().disabled).toBe(false);
  });
});
