// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location, ViewportScroller } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { DOCS_ANCHOR_SCROLL_OFFSET_PX } from '@lfx-one/shared/constants';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocsManifestService } from '../../services/docs-manifest.service';
import { DocsArticleComponent } from './docs-article.component';

/**
 * Pins the lifecycle of the docs-scoped ViewportScroller offset — a global
 * side effect set for the article route. If the reset is lost (e.g. the
 * component is later reused by a RouteReuseStrategy and teardown stops
 * firing), every other route's anchor scrolling shifts by the same amount
 * with no e2e catching it. Assertions are behavior-level: they hold whether
 * teardown is `ngOnDestroy` or `DestroyRef.onDestroy`.
 */
describe('DocsArticleComponent', () => {
  let setOffset: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    setOffset = vi.fn();

    await TestBed.configureTestingModule({
      imports: [DocsArticleComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { data: of({ article: null }) } },
        { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
        { provide: Location, useValue: { back: vi.fn() } },
        { provide: DocsManifestService, useValue: { getArticle: vi.fn() } },
        { provide: ViewportScroller, useValue: { setOffset, getScrollPosition: vi.fn(() => [0, 0]), scrollToPosition: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('applies the docs anchor offset on create and resets it on destroy', () => {
    const fixture = TestBed.createComponent(DocsArticleComponent);
    expect(setOffset).toHaveBeenCalledWith([0, DOCS_ANCHOR_SCROLL_OFFSET_PX]);

    fixture.destroy();
    expect(setOffset).toHaveBeenLastCalledWith([0, 0]);
  });
});
