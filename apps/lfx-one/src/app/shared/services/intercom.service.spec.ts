// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataDogRumService } from './datadog-rum.service';
import { IntercomService } from './intercom.service';

/**
 * Covers openMessenger(), the support-CTA entry point added for GH-1857: when startup boot was
 * skipped (impersonation, public pages, missing JWT claim) the first click must boot Intercom
 * anonymously, and boot must queue before show on the pre-load stub so the widget replays them
 * in order once its script loads.
 */
describe('IntercomService', () => {
  let service: IntercomService;

  const queuedCommands = (): unknown[][] => window.Intercom?.q ?? [];

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [{ provide: DataDogRumService, useValue: { addError: vi.fn() } }],
    });

    service = TestBed.inject(IntercomService);
  });

  afterEach(() => {
    document.querySelectorAll('script[src^="https://widget.intercom.io/"]').forEach((script) => script.remove());
    delete window.Intercom;
    delete window.intercomSettings;
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should boot anonymously and queue boot before show when startup boot was skipped', () => {
    service.openMessenger('test-app-id');

    expect(service.isBootRequested).toBe(true);
    expect(window.intercomSettings?.app_id).toBe('test-app-id');
    expect(queuedCommands()).toEqual([['boot', { app_id: 'test-app-id' }], ['show']]);
  });

  it('should not boot a second time when Intercom is already booted', () => {
    const bootSpy = vi.spyOn(service, 'boot');

    service.openMessenger('test-app-id');
    service.openMessenger('test-app-id');

    expect(bootSpy).toHaveBeenCalledTimes(1);
    expect(queuedCommands()).toEqual([['boot', { app_id: 'test-app-id' }], ['show'], ['show']]);
  });

  it('should refuse to boot without an app id and leave the click a no-op', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    service.openMessenger('');

    expect(service.isBootRequested).toBe(false);
    expect(window.Intercom).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('Intercom: boot called without app_id');
  });
});
