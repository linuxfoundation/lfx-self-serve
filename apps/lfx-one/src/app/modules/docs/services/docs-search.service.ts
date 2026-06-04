// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import type { DocsSearchEntry, DocsSearchHit, DocsSearchIndexFile } from '@lfx-one/shared/interfaces';
import MiniSearch from 'minisearch';
import { firstValueFrom } from 'rxjs';

const SEARCH_INDEX_URL = '/assets/docs/search-index.json';
const SNIPPET_LENGTH = 220;
const SNIPPET_PADDING = 60;

/**
 * Browser-only full-text search over the docs corpus. Lazy-loads the
 * pre-built MiniSearch index from `/assets/docs/search-index.json` on the
 * first `search()` call, hydrates a `MiniSearch` instance, and keeps it
 * cached for the lifetime of the page.
 *
 * SSR safety (research R8 / SSR-safety rule): server-side calls return an
 * empty result set without firing any HTTP request. The check via
 * `isPlatformBrowser` is the load-bearing gate; everything below it is
 * exclusively client-side.
 *
 * Network shape (research R5):
 *   - First search → ONE GET /assets/docs/search-index.json (≤ a few hundred
 *     KB compressed; tracked by SC-006).
 *   - Subsequent searches → zero network — the loaded MiniSearch instance
 *     handles every query in memory.
 *
 * Loading is wrapped in a single in-flight promise so concurrent first
 * searches share the same fetch (no thundering herd).
 */
@Injectable({ providedIn: 'root' })
export class DocsSearchService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private miniSearch?: MiniSearch<DocsSearchEntry>;
  private entries: Record<string, DocsSearchEntry> = {};
  private loadPromise?: Promise<void>;

  public async search(query: string, limit = 20): Promise<DocsSearchHit[]> {
    if (!this.isBrowser) return [];
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    await this.ensureLoaded();
    if (!this.miniSearch) return [];

    return this.miniSearch
      .search(trimmed, { prefix: true, fuzzy: 0.2 })
      .slice(0, limit)
      .map((result) => this.toHit(result, trimmed));
  }

  private ensureLoaded(): Promise<void> {
    if (this.miniSearch) return Promise.resolve();
    if (!this.loadPromise) {
      // Wrap the load so a single rejected fetch never permanently
      // disables search for the session. We discard the failed promise
      // and let the next `search()` retry; concurrent in-flight calls
      // still share the live promise, so we don't introduce a herd.
      this.loadPromise = this.loadIndex().catch((err) => {
        this.loadPromise = undefined;
        console.warn('[docs-search] failed to load search index; retry on next query', err);
      });
    }
    return this.loadPromise;
  }

  private async loadIndex(): Promise<void> {
    const file = await firstValueFrom(this.http.get<DocsSearchIndexFile>(SEARCH_INDEX_URL));
    // The build emits `miniSearch` as the result of `MiniSearch.toJSON()` — an
    // object. `loadJSON` accepts the serialized string, so we round-trip it
    // back to JSON here. The build's `fields`/`storeFields` MUST match this
    // load (they're declared in `scripts/lib/build-search-index.mjs`).
    const indexJson = typeof file.miniSearch === 'string' ? file.miniSearch : JSON.stringify(file.miniSearch);
    this.miniSearch = MiniSearch.loadJSON<DocsSearchEntry>(indexJson, {
      fields: ['title', 'headings', 'body', 'tags'],
      storeFields: ['url', 'topic'],
      searchOptions: {
        boost: { title: 3, headings: 2, tags: 2, body: 1 },
        prefix: true,
        fuzzy: 0.2,
        combineWith: 'AND',
      },
    });
    this.entries = file.entries ?? {};
  }

  private toHit(result: { id: string; score: number; terms: string[] }, query: string): DocsSearchHit {
    const entry = this.entries[result.id];
    return {
      id: result.id,
      url: entry?.url ?? '',
      title: entry?.title ?? result.id,
      topic: entry?.topic ?? '',
      snippet: this.snippet(entry?.body ?? '', result.terms[0] ?? query),
      score: result.score,
    };
  }

  private snippet(body: string, term: string): string {
    if (body.length === 0) return '';
    const lowered = body.toLowerCase();
    const idx = lowered.indexOf(term.toLowerCase());
    if (idx < 0) {
      return body.slice(0, SNIPPET_LENGTH).trim() + (body.length > SNIPPET_LENGTH ? '…' : '');
    }
    const start = Math.max(0, idx - SNIPPET_PADDING);
    const end = Math.min(body.length, idx + term.length + SNIPPET_LENGTH - SNIPPET_PADDING);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < body.length ? '…' : '';
    return prefix + body.slice(start, end).trim() + suffix;
  }
}
