// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, TransferState } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DEFAULT_RUNTIME_CONFIG, RUNTIME_CONFIG_KEY } from '@app/shared/providers/runtime-config.provider';
import { IntercomService } from '@services/intercom.service';
import { UserService } from '@services/user.service';
import { headerTestProviders, installMatchMediaShim } from '@shared/testing/header-test-providers';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeaderComponent } from './header.component';

beforeAll(installMatchMediaShim);

describe('HeaderComponent support entry (#4922)', () => {
  const openMessenger = vi.fn();
  const authenticated = signal(false);

  const render = async (signedIn: boolean): Promise<ComponentFixture<HeaderComponent>> => {
    authenticated.set(signedIn);
    const fixture = TestBed.createComponent(HeaderComponent);
    await fixture.whenStable();
    return fixture;
  };
  const supportButton = (fixture: ComponentFixture<HeaderComponent>) =>
    fixture.nativeElement.querySelector('[data-testid="header-support-button"]') as HTMLButtonElement | null;

  beforeEach(() => {
    openMessenger.mockReset();
    TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        ...headerTestProviders(),
        provideRouter([]),
        { provide: UserService, useValue: { authenticated, getCurrentUserProfile: () => of(null), effectiveAvatarUrl: signal(''), user: signal(null) } },
        { provide: IntercomService, useValue: { openMessenger } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    TestBed.inject(TransferState).set(RUNTIME_CONFIG_KEY, { ...DEFAULT_RUNTIME_CONFIG, intercomAppId: 'app-123' });
  });

  it.each([
    ['an anonymous viewer', false],
    ['a signed-in viewer', true],
  ])('shows a Support button to %s', async (_label, signedIn) => {
    const fixture = await render(signedIn);

    const button = supportButton(fixture);
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('Support');
  });

  it('opens the Intercom messenger through the shared directive when tapped', async () => {
    const fixture = await render(true);

    supportButton(fixture)?.click();

    expect(openMessenger).toHaveBeenCalledWith('app-123', expect.any(Function));
  });

  it('has no menu toggle: these pages render outside main-layout, so nothing would open', async () => {
    const fixture = await render(false);

    expect(fixture.nativeElement.querySelector('[data-testid="mobile-menu-toggle"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fa-bars')).toBeNull();
  });
});
