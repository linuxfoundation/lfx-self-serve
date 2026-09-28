// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location, ViewportScroller } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { DOCS_ANCHOR_SCROLL_OFFSET_PX } from '@lfx-one/shared/constants';
import type { DocsArticle } from '@lfx-one/shared/interfaces';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocsManifestService } from '../../services/docs-manifest.service';
import { DocsArticleComponent } from './docs-article.component';

/**
 * Pins two contracts:
 *
 * 1. The lifecycle of the docs-scoped ViewportScroller offset — a global
 *    side effect set for the article route. If the reset is lost (e.g. the
 *    component is later reused by a RouteReuseStrategy and teardown stops
 *    firing), every other route's anchor scrolling shifts by the same amount
 *    with no e2e catching it. Assertions are behavior-level: they hold whether
 *    teardown is `ngOnDestroy` or `DestroyRef.onDestroy`.
 * 2. The `handleAnchorClick` navigation contract — same-article fragment
 *    clicks route through the router (or scroll directly when the fragment
 *    is already active), modifier clicks fall through to native handling,
 *    and a bare `#frag` is deliberately NOT resolved at runtime: raw-HTML
 *    fragment rewriting happens at build time in sanitize.mjs, and these
 *    pins fail if a refactor silently reintroduces a runtime dependency the
 *    e2e suite can't see (no raw-HTML bare-`#` content exists in docs/user).
 */

/** Builds a renderable article whose body carries one anchor per click-path case. */
function buildArticle(): DocsArticle {
  return {
    slug: 'topic/article',
    url: '/docs/topic/article',
    sourcePath: 'docs/user/topic/article/index.md',
    topic: 'topic',
    title: 'Article',
    description: 'An article',
    bodyHtml: [
      '<p><a id="same-page" href="/docs/topic/article#section">same page</a></p>',
      '<p><a id="cross-article" href="/docs/other/article#other">cross article</a></p>',
      '<p><a id="bare" href="#section">bare fragment</a></p>',
    ].join(''),
    headings: [],
    bodyText: 'same page cross article bare fragment',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    breadcrumb: [],
    siblings: [],
    isTopicLanding: false,
  };
}

describe('DocsArticleComponent', () => {
  let setOffset: ReturnType<typeof vi.fn>;
  let scrollToAnchor: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let routeSnapshot: { fragment: string | null };

  beforeEach(async () => {
    setOffset = vi.fn();
    scrollToAnchor = vi.fn();
    navigateByUrl = vi.fn();
    routeSnapshot = { fragment: null };

    await TestBed.configureTestingModule({
      imports: [DocsArticleComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { data: of({ article: buildArticle() }), snapshot: routeSnapshot } },
        { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl } },
        { provide: Location, useValue: { back: vi.fn() } },
        { provide: HttpClient, useValue: { get: vi.fn() } },
        { provide: DocsManifestService, useValue: { getArticle: vi.fn(), getTopics: vi.fn(() => []) } },
        { provide: ViewportScroller, useValue: { setOffset, getScrollPosition: vi.fn(() => [0, 0]), scrollToPosition: vi.fn(), scrollToAnchor } },
      ],
    }).compileComponents();
  });

  function bodyAnchor(fixture: ComponentFixture<DocsArticleComponent>, id: string): HTMLAnchorElement {
    fixture.detectChanges();
    const anchor = fixture.nativeElement.querySelector(`[data-testid="docs-article-body"] a#${id}`);
    expect(anchor, `anchor #${id} rendered inside the article body`).toBeInstanceOf(HTMLAnchorElement);
    return anchor as HTMLAnchorElement;
  }

  function dispatchClick(anchor: HTMLAnchorElement, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    anchor.dispatchEvent(event);
    return event;
  }

  it('applies the docs anchor offset on create and resets it on destroy', () => {
    const fixture = TestBed.createComponent(DocsArticleComponent);
    expect(setOffset).toHaveBeenCalledWith([0, DOCS_ANCHOR_SCROLL_OFFSET_PX]);

    fixture.destroy();
    expect(setOffset).toHaveBeenLastCalledWith([0, 0]);
  });

  it('routes a plain click on a same-article fragment link through the router', () => {
    const fixture = TestBed.createComponent(DocsArticleComponent);
    const event = dispatchClick(bodyAnchor(fixture, 'same-page'));

    expect(navigateByUrl).toHaveBeenCalledWith('/docs/topic/article#section');
    expect(event.defaultPrevented).toBe(true);
    expect(scrollToAnchor).not.toHaveBeenCalled();
  });

  it('routes a plain click on a cross-article docs link through the router', () => {
    const fixture = TestBed.createComponent(DocsArticleComponent);
    const event = dispatchClick(bodyAnchor(fixture, 'cross-article'));

    expect(navigateByUrl).toHaveBeenCalledWith('/docs/other/article#other');
    expect(event.defaultPrevented).toBe(true);
    expect(scrollToAnchor).not.toHaveBeenCalled();
  });

  it('scrolls directly instead of navigating when re-clicking the active fragment', () => {
    routeSnapshot.fragment = 'section';
    const fixture = TestBed.createComponent(DocsArticleComponent);
    const event = dispatchClick(bodyAnchor(fixture, 'same-page'));

    expect(scrollToAnchor).toHaveBeenCalledWith('section');
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets modifier clicks fall through to native handling untouched', () => {
    const fixture = TestBed.createComponent(DocsArticleComponent);
    const anchor = bodyAnchor(fixture, 'same-page');
    const event = dispatchClick(anchor, { ctrlKey: true });

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(scrollToAnchor).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(anchor.getAttribute('href')).toBe('/docs/topic/article#section');
  });

  it('does not resolve a bare #fragment at runtime — rewriting is the build-time boundary', () => {
    const fixture = TestBed.createComponent(DocsArticleComponent);
    const anchor = bodyAnchor(fixture, 'bare');
    const event = dispatchClick(anchor);

    // `#section` is not a docs path, so the interceptor leaves it alone: no
    // SPA navigation, no preventDefault, no DOM rewrite. If this pin breaks
    // because runtime fragment resolution came back, sanitize.mjs is no
    // longer the single rewrite boundary.
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(scrollToAnchor).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(anchor.getAttribute('href')).toBe('#section');
  });
});
