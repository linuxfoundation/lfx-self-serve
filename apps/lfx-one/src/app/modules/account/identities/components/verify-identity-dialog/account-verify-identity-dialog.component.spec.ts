// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ConnectedIdentityFull } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountVerifyIdentityDialogComponent } from './account-verify-identity-dialog.component';

const EMAIL: ConnectedIdentityFull = {
  id: 'e1',
  provider: 'email',
  type: 'email',
  identifier: 'ada@example.com',
  state: 'unverified',
  icon: 'fa-light fa-envelope',
  isPrimary: false,
};
const GITHUB: ConnectedIdentityFull = {
  id: 'g1',
  provider: 'github',
  type: 'username',
  identifier: 'ada',
  state: 'unverified',
  icon: 'fa-brands fa-github',
  isPrimary: false,
} as ConnectedIdentityFull;

describe('AccountVerifyIdentityDialogComponent', () => {
  async function render(identity: ConnectedIdentityFull) {
    const close = vi.fn();
    const userService = { sendEmailVerificationCode: vi.fn(() => of({ success: true })), verifyAndLinkEmail: vi.fn(() => of({ success: true })) };
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: DialogRef, useValue: { close } },
        { provide: DIALOG_DATA, useValue: { identity } },
        { provide: UserService, useValue: userService },
        { provide: UiToastService, useValue: { show: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountVerifyIdentityDialogComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    const click = async (testId: string) => {
      (query(testId)?.querySelector('button') ?? query(testId))?.click();
      await fixture.whenStable();
    };
    return { query, click, close, userService, fixture };
  }

  it('names the identity, then sends a code and verifies the email', async () => {
    const { query, click, close, userService, fixture } = await render(EMAIL);
    expect(query('account-verify-identity-context')?.textContent).toContain('ada@example.com');
    expect(query('account-verify-identity-send-text')?.textContent).toContain('We’ll send a 6-digit code to ada@example.com');

    await click('account-verify-identity-send');
    const input = query('account-email-code-input')?.querySelector('input') as HTMLInputElement;
    input.value = '654321';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await click('account-verify-identity-verify');

    expect(userService.verifyAndLinkEmail).toHaveBeenCalledWith('ada@example.com', '654321');
    expect(close).toHaveBeenCalledWith(true);
  });

  it('asks a social identity to sign in to its provider', async () => {
    const { query } = await render(GITHUB);

    expect(query('account-verify-identity-social')?.textContent).toContain('Sign in to GitHub');
    expect(query('account-verify-identity-continue')?.textContent?.trim()).toBe('Continue with GitHub');
    expect(query('account-verify-identity-send')).toBeNull();
  });
});
