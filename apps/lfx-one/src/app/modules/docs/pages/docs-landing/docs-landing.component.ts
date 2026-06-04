// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DOCS_CANONICAL_ORIGIN } from '@lfx-one/shared/constants';
import type { DocsTopic } from '@lfx-one/shared/interfaces';

import { DocsSearchComponent } from '../../components/docs-search/docs-search.component';
import { DocsTopicCardComponent } from '../../components/docs-topic-card/docs-topic-card.component';
import { DocsManifestService } from '../../services/docs-manifest.service';

const LANDING_TITLE = 'LFX Self Serve Documentation';
const LANDING_DESCRIPTION = 'Browse user guides, FAQs, and how-tos for the LFX Self Serve product — meetings, committees, mailing lists, and more.';

/**
 * Public-facing landing page at `/docs`.
 *
 * Renders a topic-card grid sourced from `DocsManifestService.getTopics()` —
 * one tile per top-level topic in `docs/user/`. Per task notes (T024), this
 * page deliberately IGNORES any VitePress `layout: home` / `hero:` /
 * `features:` block in `docs/user/index.md`; the canonical landing UX is the
 * topic grid (research R8).
 *
 * Search is wired in via `DocsSearchComponent` above the topic grid (US3 /
 * T039) so visitors can full-text-search the entire docs corpus from the
 * landing page without first picking a topic. The component fetches the
 * MiniSearch index lazily on first focus to keep SSR and initial paint
 * cheap.
 *
 * SEO: title, description, OpenGraph and Twitter-card meta tags are wired in
 * `ngOnInit` for discoverability (FR-013, FR-023). A `<link rel="canonical">`
 * is appended to the document head pointing at the production origin so deep
 * scans from staging or preview environments don't rank duplicate URLs.
 */
@Component({
  selector: 'lfx-docs-landing',
  standalone: true,
  imports: [DocsSearchComponent, DocsTopicCardComponent],
  templateUrl: './docs-landing.component.html',
})
export class DocsLandingComponent implements OnInit {
  private readonly docsManifest = inject(DocsManifestService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  protected readonly topics: DocsTopic[] = this.docsManifest.getTopics();

  public ngOnInit(): void {
    this.applyMetadata();
  }

  private applyMetadata(): void {
    const canonical = `${DOCS_CANONICAL_ORIGIN}/docs`;
    this.title.setTitle(LANDING_TITLE);
    this.meta.updateTag({ name: 'description', content: LANDING_DESCRIPTION });
    this.meta.updateTag({ property: 'og:title', content: LANDING_TITLE });
    this.meta.updateTag({ property: 'og:description', content: LANDING_DESCRIPTION });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: LANDING_TITLE });
    this.meta.updateTag({ name: 'twitter:description', content: LANDING_DESCRIPTION });
    this.setCanonical(canonical);
    // Clear any noindex tag that the not-found page may have left behind
    // when the visitor navigated client-side from `/docs/<missing>` here.
    this.meta.removeTag('name="robots"');
  }

  private setCanonical(href: string): void {
    let link = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', href);
  }
}
