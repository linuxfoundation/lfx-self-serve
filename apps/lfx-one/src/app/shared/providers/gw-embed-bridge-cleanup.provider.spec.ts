// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GW_EMBED_SIGNIN_STATE_KEY, GW_EMBED_STORAGE_KEY_PREFIX } from '@lfx-one/shared/constants';
import { RuntimeConfig } from '@lfx-one/shared/interfaces';
import { afterEach, describe, expect, it } from 'vitest';

import { initializeGwEmbedBridgeCleanup } from './gw-embed-bridge-cleanup.provider';
import { DEFAULT_RUNTIME_CONFIG, RUNTIME_CONFIG_KEY } from './runtime-config.provider';

describe('initializeGwEmbedBridgeCleanup', () => {
  const STORED_KEY = `${GW_EMBED_STORAGE_KEY_PREFIX}lfx_embed`;

  const run = (platform: 'browser' | 'server', config: Partial<RuntimeConfig> = {}): void => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
    TestBed.inject(TransferState).set(RUNTIME_CONFIG_KEY, { ...DEFAULT_RUNTIME_CONFIG, ...config });
    window.localStorage.setItem(STORED_KEY, 'session');
    window.sessionStorage.setItem(GW_EMBED_SIGNIN_STATE_KEY, 'nonce');
    TestBed.runInInjectionContext(() => initializeGwEmbedBridgeCleanup());
  };

  afterEach(() => {
    TestBed.resetTestingModule();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  const at = (url: string): void => window.history.replaceState(null, '', url);

  it.each([
    ['on', true],
    ['off', false],
  ])('removes stored bridge sessions and sign-in keys at app start with host-session mode %s', (_label, gwHostSession) => {
    // The bridge is gone, so its tokens are removed whatever the Gatewaze flags say.
    run('browser', { gwHostSession });

    expect(window.localStorage.getItem(STORED_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(GW_EMBED_SIGNIN_STATE_KEY)).toBeNull();
  });

  it('scrubs a token fragment from the address bar and keeps the path and query', () => {
    at('/foundation/gw/newsletters?project=aaif#access_token=at&refresh_token=rt');

    run('browser');

    expect(window.location.hash).toBe('');
    expect(`${window.location.pathname}${window.location.search}`).toBe('/foundation/gw/newsletters?project=aaif');
  });

  it.each([['#refresh_token=rt'], ['#id_token=it']])('scrubs a fragment carrying only %s', (fragment) => {
    at(`/foundation/gw/newsletters${fragment}`);

    run('browser');

    expect(window.location.hash).toBe('');
  });

  it('leaves a plain in-page anchor alone', () => {
    at('/foundation/gw/newsletters#section-two');

    run('browser');

    expect(window.location.hash).toBe('#section-two');
  });

  it('does nothing during server rendering', () => {
    at('/foundation/gw/newsletters#access_token=at');

    run('server');

    expect(window.localStorage.getItem(STORED_KEY)).toBe('session');
    expect(window.location.hash).toBe('#access_token=at');
  });
});
