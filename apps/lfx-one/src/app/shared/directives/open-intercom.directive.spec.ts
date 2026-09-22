// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal, TransferState } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_RUNTIME_CONFIG, RUNTIME_CONFIG_KEY } from '@app/shared/providers/runtime-config.provider';
import { User } from '@lfx-one/shared/interfaces';
import { IntercomService } from '@services/intercom.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenIntercomDirective } from './open-intercom.directive';

@Component({
  selector: 'lfx-open-intercom-test-host',
  imports: [OpenIntercomDirective],
  template: '<a lfxOpenIntercom href="#">Contact support</a>',
})
class TestHostComponent {}

/**
 * Covers the user-visible decisions GH-1857 put in the directive rather than the service: an
 * empty intercomAppId fails visibly (toast) instead of delegating to boot()'s console.warn
 * refusal — which is also what makes the service's openMessenger('') spec a backstop rather
 * than a production path — and a widget script that fails to load after the click surfaces
 * the same toast through the load-error callback wired into openMessenger().
 */
describe('OpenIntercomDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let transferState: TransferState;
  let add: ReturnType<typeof vi.fn>;
  let openMessenger: ReturnType<typeof vi.fn>;
  let userSignal: ReturnType<typeof signal<User | null>>;

  const identifiedUser: User = {
    sid: 'sid',
    'https://sso.linuxfoundation.org/claims/username': 'alice',
    'http://lfx.dev/claims/intercom': 'intercom-jwt',
    given_name: 'Alice',
    family_name: 'Example',
    nickname: 'alice',
    name: 'Alice Example',
    picture: '',
    updated_at: '',
    email: 'alice@example.com',
    email_verified: true,
    sub: 'auth0|alice',
  };

  const supportLink = (): HTMLAnchorElement => {
    const el = fixture.nativeElement.querySelector('[lfxOpenIntercom]');
    if (!el) throw new Error('no support link rendered');
    return el as HTMLAnchorElement;
  };

  beforeEach(async () => {
    add = vi.fn();
    openMessenger = vi.fn();
    userSignal = signal<User | null>(null);

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        { provide: MessageService, useValue: { add } },
        { provide: IntercomService, useValue: { openMessenger } },
        { provide: UserService, useValue: { user: userSignal } },
      ],
    }).compileComponents();

    transferState = TestBed.inject(TransferState);
    fixture = TestBed.createComponent(TestHostComponent);
    await fixture.whenStable();
  });

  it('shows the unavailable toast and skips the messenger when no app id is configured', () => {
    // RUNTIME_CONFIG_KEY unset: getRuntimeConfig falls back to DEFAULT_RUNTIME_CONFIG (empty id).
    supportLink().click();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Support Unavailable' }));
    expect(openMessenger).not.toHaveBeenCalled();
  });

  it('opens the messenger with a load-error callback when an app id is configured', () => {
    transferState.set(RUNTIME_CONFIG_KEY, { ...DEFAULT_RUNTIME_CONFIG, intercomAppId: 'test-app-id' });

    supportLink().click();

    expect(openMessenger).toHaveBeenCalledWith('test-app-id', expect.any(Function));
    expect(add).not.toHaveBeenCalled();
  });

  it('boots Intercom with the signed-in identity when UserService has a user (GH-2290)', () => {
    userSignal.set(identifiedUser);
    transferState.set(RUNTIME_CONFIG_KEY, { ...DEFAULT_RUNTIME_CONFIG, intercomAppId: 'test-app-id' });

    supportLink().click();

    expect(openMessenger).toHaveBeenCalledWith(
      'test-app-id',
      expect.any(Function),
      expect.objectContaining({
        app_id: 'test-app-id',
        user_id: 'alice',
        name: 'Alice Example',
        email: 'alice@example.com',
        intercom_user_jwt: 'intercom-jwt',
      })
    );
  });

  it('shows the unavailable toast when the widget script fails to load after the click', () => {
    transferState.set(RUNTIME_CONFIG_KEY, { ...DEFAULT_RUNTIME_CONFIG, intercomAppId: 'test-app-id' });

    supportLink().click();
    const onLoadError: unknown = openMessenger.mock.calls[0]?.[1];
    if (typeof onLoadError !== 'function') {
      throw new Error('openMessenger was not given a load-error callback');
    }
    onLoadError();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Support Unavailable' }));
  });
});
