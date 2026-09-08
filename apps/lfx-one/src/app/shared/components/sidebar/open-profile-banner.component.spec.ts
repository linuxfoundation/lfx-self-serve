// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TransferState } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_RUNTIME_CONFIG, RUNTIME_CONFIG_KEY } from '@app/shared/providers/runtime-config.provider';
import { IntercomService } from '@services/intercom.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenProfileBannerComponent } from './open-profile-banner.component';

/**
 * Renders the component's real template (unlike sidebar.component.spec.ts, which stubs it out) so a
 * dropped (click) binding or a `show` regression fails this spec, not just a manual click-through.
 * IntercomService/MessageService are stubbed the same way open-intercom.directive.spec.ts does —
 * this only needs to prove the click reaches lfxOpenIntercom, not re-verify the directive's own
 * toast/boot behavior.
 */
describe('OpenProfileBannerComponent', () => {
  let fixture: ComponentFixture<OpenProfileBannerComponent>;
  let transferState: TransferState;
  let openMessenger: ReturnType<typeof vi.fn>;
  let linkClick: ReturnType<typeof vi.fn>;

  const link = (): HTMLButtonElement => {
    const el = fixture.nativeElement.querySelector('[data-testid="open-profile-banner-link"]');
    if (!el) throw new Error('banner link not rendered');
    return el as HTMLButtonElement;
  };

  const slot = (): HTMLElement => {
    const el = fixture.nativeElement.querySelector('[data-testid="open-profile-banner-slot"]');
    if (!el) throw new Error('banner slot not rendered');
    return el as HTMLElement;
  };

  beforeEach(async () => {
    openMessenger = vi.fn();
    linkClick = vi.fn();

    await TestBed.configureTestingModule({
      imports: [OpenProfileBannerComponent],
      providers: [
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: IntercomService, useValue: { openMessenger } },
      ],
    }).compileComponents();

    transferState = TestBed.inject(TransferState);
    transferState.set(RUNTIME_CONFIG_KEY, { ...DEFAULT_RUNTIME_CONFIG, intercomAppId: 'test-app-id' });

    fixture = TestBed.createComponent(OpenProfileBannerComponent);
    fixture.componentInstance.linkClick.subscribe(linkClick);
  });

  it('hides the banner slot when show is false', () => {
    fixture.componentRef.setInput('show', false);
    fixture.detectChanges();

    expect(slot().classList.contains('hidden')).toBe(true);
  });

  it('shows the banner slot when show is true', () => {
    fixture.componentRef.setInput('show', true);
    fixture.detectChanges();

    expect(slot().classList.contains('hidden')).toBe(false);
  });

  it('clicking the link emits linkClick and opens the Intercom messenger', () => {
    fixture.componentRef.setInput('show', true);
    fixture.detectChanges();

    link().click();

    expect(linkClick).toHaveBeenCalledTimes(1);
    expect(openMessenger).toHaveBeenCalledWith('test-app-id', expect.any(Function));
  });
});
