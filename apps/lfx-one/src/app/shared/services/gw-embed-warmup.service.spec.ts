// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { DestroyRef, PLATFORM_ID, signal, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GW_EMBED_FOUNDATION_NEWSLETTERS_LINK, GW_EMBED_HOST_SESSION_ME_URL, GW_EMBED_PROJECT_NEWSLETTERS_LINK } from '@lfx-one/shared/constants';
import { RuntimeConfig } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RUNTIME_CONFIG, RUNTIME_CONFIG_KEY } from '../providers/runtime-config.provider';
import { GwEmbedWarmupService } from './gw-embed-warmup.service';
import { UserService } from './user.service';

const EMBED_URL = 'https://admin.example.test/embed';

describe('GwEmbedWarmupService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let impersonating: ReturnType<typeof signal<boolean>>;

  const setup = (runtimeConfig: Partial<RuntimeConfig> = {}, platform: 'browser' | 'server' = 'browser'): GwEmbedWarmupService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        { provide: UserService, useValue: { impersonating } },
      ],
    });
    TestBed.inject(TransferState).set(RUNTIME_CONFIG_KEY, {
      ...DEFAULT_RUNTIME_CONFIG,
      gwSupabaseUrl: 'https://data.example.test',
      gwSupabaseAnonKey: 'anon',
      gwEmbedUrl: EMBED_URL,
      gwHostSession: true,
      ...runtimeConfig,
    });
    return TestBed.inject(GwEmbedWarmupService);
  };

  const hints = (): HTMLLinkElement[] => Array.from(TestBed.inject(DOCUMENT).head.querySelectorAll<HTMLLinkElement>('link[data-gw-embed-hint]'));

  beforeEach(() => {
    impersonating = signal(false);
    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    hints().forEach((link) => link.remove());
  });

  describe('warmSession', () => {
    it('sends the request the embed sends, once per page session, and never reads the answer', () => {
      const service = setup();

      service.warmSession();
      service.warmSession();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(GW_EMBED_HOST_SESSION_ME_URL, { credentials: 'include', headers: { apikey: 'anon' } });
    });

    it('swallows a failed request', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('network down'));
      const service = setup();

      expect(() => service.warmSession()).not.toThrow();
      await Promise.resolve();
    });

    it('does nothing on the server', () => {
      setup({}, 'server').warmSession();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does nothing while impersonating, since the route refuses to mint then', () => {
      impersonating.set(true);
      setup().warmSession();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([[{ gwHostSession: false }], [{ gwSupabaseAnonKey: '' }]])('does nothing when host-session mode is not usable (%o)', (config) => {
      setup(config).warmSession();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('preconnect', () => {
    it('adds a CORS preconnect and a dns-prefetch for the embed origin, once', () => {
      const service = setup();

      service.preconnect();
      service.preconnect();

      const links = hints();
      expect(links.map((link) => [link.rel, link.getAttribute('href'), link.hasAttribute('crossorigin')])).toEqual([
        ['preconnect', 'https://admin.example.test', true],
        ['dns-prefetch', 'https://admin.example.test', false],
      ]);
    });

    it('runs on the server too, so the hint is in the rendered head', () => {
      setup({}, 'server').preconnect();

      expect(hints()).toHaveLength(2);
    });

    it.each([[{ gwHostSession: false }], [{ gwEmbedUrl: '' }], [{ gwEmbedUrl: 'not a url' }]])(
      'adds nothing when the embed is off or unusable (%o)',
      (config) => {
        setup(config).preconnect();

        expect(hints()).toHaveLength(0);
      }
    );
  });

  describe('watchNavIntent', () => {
    let host: HTMLElement;
    let destroyCallbacks: (() => void)[];
    const destroyRef = { onDestroy: (fn: () => void) => destroyCallbacks.push(fn) } as unknown as DestroyRef;

    const link = (href: string): HTMLAnchorElement => {
      const anchor = document.createElement('a');
      anchor.href = href;
      const label = document.createElement('span');
      anchor.appendChild(label);
      host.appendChild(anchor);
      return anchor;
    };

    beforeEach(() => {
      destroyCallbacks = [];
      host = document.createElement('aside');
      document.body.appendChild(host);
    });

    afterEach(() => host.remove());

    it.each([[GW_EMBED_FOUNDATION_NEWSLETTERS_LINK], [GW_EMBED_PROJECT_NEWSLETTERS_LINK]])(
      'warms on hover over the embed link %s, from a child too',
      (href) => {
        const service = setup();
        service.watchNavIntent(host, destroyRef);

        link(href).firstElementChild?.dispatchEvent(new Event('pointerover', { bubbles: true }));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(hints()).toHaveLength(2);
      }
    );

    it('warms on keyboard focus, and only once however often the link is reached', () => {
      const service = setup();
      service.watchNavIntent(host, destroyRef);
      const anchor = link(`${GW_EMBED_FOUNDATION_NEWSLETTERS_LINK}?project=agentic-ai-foundation`);

      anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      anchor.dispatchEvent(new Event('pointerover', { bubbles: true }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('ignores every other link', () => {
      const service = setup();
      service.watchNavIntent(host, destroyRef);

      link('/foundation/newsletters').dispatchEvent(new Event('pointerover', { bubbles: true }));
      link('/foundation/gw/newsletters/123').dispatchEvent(new Event('pointerover', { bubbles: true }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(hints()).toHaveLength(0);
    });

    it('stops listening when the host is destroyed', () => {
      const service = setup();
      service.watchNavIntent(host, destroyRef);
      destroyCallbacks.forEach((fn) => fn());

      link(GW_EMBED_FOUNDATION_NEWSLETTERS_LINK).dispatchEvent(new Event('pointerover', { bubbles: true }));

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('listens to nothing on the server', () => {
      const addEventListener = vi.spyOn(host, 'addEventListener');
      setup({}, 'server').watchNavIntent(host, destroyRef);

      expect(addEventListener).not.toHaveBeenCalled();
    });
  });
});
