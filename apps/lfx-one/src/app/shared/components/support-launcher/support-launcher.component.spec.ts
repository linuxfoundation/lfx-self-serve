// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IntercomService } from '@services/intercom.service';
import { OverlayStateService } from '@services/overlay-state.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportLauncherComponent } from './support-launcher.component';

describe('SupportLauncherComponent', () => {
  let fixture: ComponentFixture<SupportLauncherComponent>;
  let customLauncherActive: ReturnType<typeof signal<boolean>>;
  let overlayState: OverlayStateService;
  let update: ReturnType<typeof vi.fn>;
  let openMessenger: ReturnType<typeof vi.fn>;

  const button = (): HTMLButtonElement => fixture.nativeElement.querySelector('[data-testid="support-launcher"]');

  beforeEach(async () => {
    customLauncherActive = signal(true);
    update = vi.fn();
    openMessenger = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SupportLauncherComponent],
      providers: [{ provide: IntercomService, useValue: { customLauncherActive, update, openMessenger } }],
    }).compileComponents();

    overlayState = TestBed.inject(OverlayStateService);
    fixture = TestBed.createComponent(SupportLauncherComponent);
    await fixture.whenStable();
  });

  it('should render a button Intercom can bind to by id', () => {
    expect(button().id).toBe('lfx-support-launcher');
    expect(button().classList.contains('hidden')).toBe(false);
  });

  it('should leave opening the messenger to Intercom, so a tap cannot open then close it', () => {
    button().click();

    expect(openMessenger).not.toHaveBeenCalled();
  });

  it('should ask the widget to re-scan for the launcher after it renders', () => {
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('should stay in the DOM but hidden when the custom launcher is not active (desktop)', async () => {
    customLauncherActive.set(false);
    await fixture.whenStable();

    expect(button()).not.toBeNull();
    expect(button().classList.contains('hidden')).toBe(true);
  });

  it('should hide while any overlay is open and return when it closes', async () => {
    overlayState.register('drawer');
    await fixture.whenStable();
    expect(button().classList.contains('hidden')).toBe(true);

    overlayState.unregister('drawer');
    await fixture.whenStable();
    expect(button().classList.contains('hidden')).toBe(false);
  });

  it('should hide while a sticky bottom bar is visible', async () => {
    overlayState.stickyBarVisible.set(true);
    await fixture.whenStable();
    expect(button().classList.contains('hidden')).toBe(true);

    overlayState.stickyBarVisible.set(false);
    await fixture.whenStable();
    expect(button().classList.contains('hidden')).toBe(false);
  });
});
