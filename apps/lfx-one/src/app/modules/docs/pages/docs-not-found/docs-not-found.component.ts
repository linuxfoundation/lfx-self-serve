// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { DocsTopic } from '@lfx-one/shared/interfaces';

import { DocsManifestService } from '../../services/docs-manifest.service';

/**
 * Brand-styled docs 404 (FR-014). Rendered inline by `DocsArticleComponent` on a
 * miss (URL unchanged) and directly at `/docs/not-found`; both return HTTP 404.
 *
 * Sets `robots: noindex` so neither surface is indexed while still offering recovery links.
 */
@Component({
  selector: 'lfx-docs-not-found',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './docs-not-found.component.html',
})
export class DocsNotFoundComponent implements OnInit {
  private readonly docsManifest = inject(DocsManifestService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  protected readonly topics: DocsTopic[] = this.docsManifest.getTopics();

  public ngOnInit(): void {
    const title = 'Page not found · LFX Documentation';
    const description = 'The documentation page you requested could not be found.';

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ name: 'robots', content: 'noindex' });

    // Clear article-level OG / Twitter tags that may linger from a preceding
    // client-side article → not-found navigation. The not-found page is
    // noindex so there is no meaningful canonical or og:url to set.
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.removeTag('property="og:type"');
    this.meta.removeTag('property="og:url"');
    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.document.querySelector('link[rel="canonical"]')?.remove();
  }
}
