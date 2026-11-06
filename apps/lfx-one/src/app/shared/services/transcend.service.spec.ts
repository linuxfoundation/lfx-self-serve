// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CONSENT_PROMPT_HIDDEN_CLASS } from '@lfx-one/shared/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranscendService } from './transcend.service';

/**
 * Covers showPreferences(), the only way to reopen cookie preferences after the Osano removal
 * (linuxfoundation/lfx-self-serve-ops#513): the footer "Cookie settings" links and the public
 * profile "Manage cookie preferences" button all call it.
 */
describe('TranscendService', () => {
  const setup = (platform: 'browser' | 'server' = 'browser'): TranscendService => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
    return TestBed.inject(TranscendService);
  };

  afterEach(() => {
    delete window.transcend;
    document.documentElement.classList.remove(CONSENT_PROMPT_HIDDEN_CLASS);
    vi.restoreAllMocks();
  });

  it('should open the Transcend consent manager once airgap.js has defined it', () => {
    const showConsentManager = vi.fn();
    window.transcend = { showConsentManager };

    setup().showPreferences();

    expect(showConsentManager).toHaveBeenCalledTimes(1);
  });

  it('should warn instead of failing silently when airgap.js did not load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setup().showPreferences();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('should do nothing during server-side rendering', () => {
    const showConsentManager = vi.fn();
    window.transcend = { showConsentManager };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setup('server').showPreferences();

    expect(showConsentManager).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('should hide and restore the automatic prompt with a class on <html>', () => {
    const service = setup();

    service.suppressPrompt();
    expect(document.documentElement.classList.contains(CONSENT_PROMPT_HIDDEN_CLASS)).toBe(true);

    service.restorePrompt();
    expect(document.documentElement.classList.contains(CONSENT_PROMPT_HIDDEN_CLASS)).toBe(false);
  });

  it('should un-hide the prompt when the reader asks for cookie settings', () => {
    const showConsentManager = vi.fn();
    window.transcend = { showConsentManager };
    const service = setup();
    service.suppressPrompt();

    service.showPreferences();

    expect(document.documentElement.classList.contains(CONSENT_PROMPT_HIDDEN_CLASS)).toBe(false);
    expect(showConsentManager).toHaveBeenCalledTimes(1);
  });
});
