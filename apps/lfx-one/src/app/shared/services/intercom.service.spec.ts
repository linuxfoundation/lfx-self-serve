// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { INTERCOM_CUSTOM_LAUNCHER_SELECTOR } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataDogRumService } from './datadog-rum.service';
import { IntercomService } from './intercom.service';

/**
 * Covers openMessenger(), the support-CTA entry point added for GH-1857: when startup boot was
 * skipped (impersonation, public pages, missing JWT claim) the first click must boot Intercom
 * anonymously, and boot must queue before show on the pre-load stub so the widget replays them
 * in order once its script loads. A click whose widget script fails to load must invoke the
 * caller's error callback so the CTA can fail visibly — including a click landing while a
 * startup boot is still in flight — and a successful load must clear the callback.
 * Also covers update() (#2986): a no-op before boot, and once booted a queued
 * ['reattach_activator'] + ['update', settings] pair so custom launchers router-mounted into
 * the DOM after boot get re-scanned and bound.
 */
describe('IntercomService', () => {
  let service: IntercomService;

  const queuedCommands = (): unknown[][] => window.Intercom?.q ?? [];
  const widgetScript = (): HTMLScriptElement | null => document.querySelector('script[src^="https://widget.intercom.io/"]');

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

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

  it('should take the invite token out of the address bar before an on-demand boot', () => {
    window.history.pushState({}, '', '/mentorship/mentor/invites?token=SUPER.SECRET');
    try {
      service.openMessenger('test-app-id');

      expect(window.location.href).not.toContain('SECRET');
      expect(new URL(window.location.href).searchParams.get('token')).toBe('redacted');
      expect(queuedCommands()[0]?.[0]).toBe('boot');
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('should leave an ordinary URL alone on boot', () => {
    window.history.pushState({}, '', '/meetings?token=keep');
    try {
      service.openMessenger('test-app-id');

      expect(window.location.search).toBe('?token=keep');
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('should boot anonymously and queue boot before show when startup boot was skipped', () => {
    service.openMessenger('test-app-id');

    expect(service.isBootRequested).toBe(true);
    expect(window.intercomSettings?.app_id).toBe('test-app-id');
    expect(queuedCommands()).toEqual([['boot', { app_id: 'test-app-id' }], ['show']]);
  });

  it('should boot with the staged identity when one was recorded (GH-2290)', () => {
    const identified = { app_id: 'test-app-id', user_id: 'alice', name: 'Alice Example', email: 'alice@example.com' };
    service.setIdentity(identified);

    service.openMessenger('test-app-id');

    expect(queuedCommands()).toEqual([['boot', identified], ['show']]);
  });

  it('should drop the staged identity on shutdown so the next boot is not the previous user', () => {
    service.setIdentity({ app_id: 'test-app-id', user_id: 'alice', name: 'Alice Example', email: 'alice@example.com' });

    service.shutdown();
    service.openMessenger('test-app-id');

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

  it('should invoke the load-error callback and allow a retry when the widget script fails to load', () => {
    const onLoadError = vi.fn();

    service.openMessenger('test-app-id', onLoadError);
    widgetScript()?.onerror?.call(widgetScript() as GlobalEventHandlers, new Event('error'));

    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(service.isBootRequested).toBe(false);

    // A later click re-attempts the boot with a fresh script element.
    service.openMessenger('test-app-id', onLoadError);

    expect(service.isBootRequested).toBe(true);
    expect(document.querySelectorAll('script[src^="https://widget.intercom.io/"]')).toHaveLength(1);
    // The failed attempt's stub queue is discarded, so the retry queues exactly one boot + show.
    expect(queuedCommands()).toEqual([['boot', { app_id: 'test-app-id' }], ['show']]);
  });

  it('should clear the load-error callback once the widget script loads', () => {
    const onLoadError = vi.fn();

    service.openMessenger('test-app-id', onLoadError);
    widgetScript()?.onload?.call(widgetScript() as GlobalEventHandlers, new Event('load'));
    widgetScript()?.onerror?.call(widgetScript() as GlobalEventHandlers, new Event('error'));

    expect(onLoadError).not.toHaveBeenCalled();
  });

  it('should open a new conversation with the pre-fill instead of show, before and after the script loads', () => {
    service.openMessenger('test-app-id', undefined, 'Pre-filled text');

    // Pre-load: the stub queues showNewMessage behind boot for replay.
    expect(queuedCommands()).toEqual([
      ['boot', { app_id: 'test-app-id' }],
      ['showNewMessage', 'Pre-filled text'],
    ]);

    widgetScript()?.onload?.call(widgetScript() as GlobalEventHandlers, new Event('load'));
    const loaded = vi.fn();
    window.Intercom = loaded as unknown as typeof window.Intercom;

    service.openMessenger('test-app-id', undefined, 'Pre-filled text');

    expect(loaded).toHaveBeenCalledWith('showNewMessage', 'Pre-filled text');
    expect(loaded).not.toHaveBeenCalledWith('show');
  });

  it('should still show the messenger when no pre-fill is given', () => {
    service.openMessenger('test-app-id');

    expect(queuedCommands()).toEqual([['boot', { app_id: 'test-app-id' }], ['show']]);
  });

  it('should treat an empty pre-fill as no pre-fill', () => {
    service.openMessenger('test-app-id', undefined, '');

    expect(queuedCommands()).toEqual([['boot', { app_id: 'test-app-id' }], ['show']]);
  });

  it('should no-op update when Intercom has not been booted', () => {
    service.update();

    expect(queuedCommands()).toEqual([]);
  });

  it('should queue reattach_activator and an update with the current settings once booted, so post-boot DOM insertions re-bind', () => {
    service.boot({ app_id: 'test-app-id' });

    service.update();

    expect(queuedCommands()).toEqual([['boot', { app_id: 'test-app-id' }], ['reattach_activator'], ['update', window.intercomSettings]]);
  });

  it('should invoke the load-error callback for a click landing while a startup boot is still loading', () => {
    service.boot({ app_id: 'test-app-id' });
    const onLoadError = vi.fn();

    service.openMessenger('test-app-id', onLoadError);
    widgetScript()?.onerror?.call(widgetScript() as GlobalEventHandlers, new Event('error'));

    expect(onLoadError).toHaveBeenCalledTimes(1);
  });

  describe('setLauncherHidden (#5416)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should hide and restore the default launcher once booted', () => {
      service.boot({ app_id: 'test-app-id' });

      service.setLauncherHidden(true);
      service.setLauncherHidden(false);

      expect(queuedCommands().slice(1)).toEqual([
        ['update', { hide_default_launcher: true }],
        ['update', { hide_default_launcher: false }],
      ]);
      expect(window.intercomSettings?.hide_default_launcher).toBe(false);
    });

    it('should not repeat an update for an unchanged request', () => {
      service.boot({ app_id: 'test-app-id' });

      service.setLauncherHidden(true);
      service.setLauncherHidden(true);

      expect(queuedCommands().slice(1)).toEqual([['update', { hide_default_launcher: true }]]);
    });

    it('should only record the request before boot, and boot with the launcher hidden', () => {
      service.setLauncherHidden(true);
      expect(window.Intercom).toBeUndefined();

      service.boot({ app_id: 'test-app-id' });

      expect(queuedCommands()[0]).toEqual(['boot', { app_id: 'test-app-id', hide_default_launcher: true }]);
      expect(window.intercomSettings?.hide_default_launcher).toBe(true);
    });

    it('should leave a phone boot untouched, since the compact launcher (#4865) already replaces the bubble', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
      service.boot({ app_id: 'test-app-id' });
      const settingsAfterBoot = { ...window.intercomSettings };

      service.setLauncherHidden(true);
      service.setLauncherHidden(false);

      expect(queuedCommands().slice(1)).toEqual([]);
      expect(window.intercomSettings).toEqual(settingsAfterBoot);
    });

    it('should keep the default launcher hidden on restore when the boot hid it explicitly', () => {
      service.boot({ app_id: 'test-app-id', hide_default_launcher: true });

      service.setLauncherHidden(true);
      service.setLauncherHidden(false);

      expect(queuedCommands().slice(1)).toEqual([
        ['update', { hide_default_launcher: true }],
        ['update', { hide_default_launcher: true }],
      ]);
    });
  });

  describe('compact launcher (#4865)', () => {
    const stubMatchMedia = (matches: boolean): void => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should boot with the default launcher hidden and the custom launcher selector on a phone viewport', () => {
      stubMatchMedia(true);

      service.boot({ app_id: 'test-app-id' });

      const launcher = { hide_default_launcher: true, custom_launcher_selector: INTERCOM_CUSTOM_LAUNCHER_SELECTOR };
      expect(queuedCommands()[0]).toEqual(['boot', { app_id: 'test-app-id', ...launcher }]);
      expect(window.intercomSettings).toMatchObject(launcher);
      expect(service.customLauncherActive()).toBe(true);
    });

    it('should boot exactly as before on a desktop viewport', () => {
      stubMatchMedia(false);

      service.boot({ app_id: 'test-app-id' });

      expect(queuedCommands()[0]).toEqual(['boot', { app_id: 'test-app-id' }]);
      expect(window.intercomSettings).not.toHaveProperty('hide_default_launcher');
      expect(service.customLauncherActive()).toBe(false);
    });

    it('should not add any user identifier beyond the staged boot options', () => {
      stubMatchMedia(true);
      const identified = { app_id: 'test-app-id', user_id: 'alice', name: 'Alice Example', email: 'alice@example.com' };

      service.boot(identified);

      const [, bootOptions] = queuedCommands()[0] as [string, Record<string, unknown>];
      expect(Object.keys(bootOptions).sort()).toEqual(['app_id', 'custom_launcher_selector', 'email', 'hide_default_launcher', 'name', 'user_id']);
    });

    it('should drop the custom launcher on shutdown', () => {
      stubMatchMedia(true);
      service.boot({ app_id: 'test-app-id' });

      service.shutdown();

      expect(service.customLauncherActive()).toBe(false);
    });

    it('should drop the custom launcher when the widget script fails to load', () => {
      stubMatchMedia(true);
      service.boot({ app_id: 'test-app-id' });

      widgetScript()?.onerror?.call(widgetScript() as GlobalEventHandlers, new Event('error'));

      expect(service.customLauncherActive()).toBe(false);
    });
  });
});
