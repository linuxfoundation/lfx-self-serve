// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { DocsTopic } from '@lfx-one/shared/interfaces';

import { DocsManifestService } from '../../services/docs-manifest.service';

/**
 * Brand-styled 404 surfaced when a `/docs/<missing>` URL doesn't resolve to
 * any article in the manifest (FR-014 / Edge Case 4).
 *
 * The HTTP-status side of the contract is enforced server-side via the
 * dedicated `/docs/not-found` entry in `apps/lfx-one/src/app/app.routes.server.ts`
 * (status: 404). The article resolver redirects miss-URLs to this route, so
 * SSR returns 404 to crawlers — preserving correct status semantics for
 * search-engine indexing while still showing a useful recovery page.
 *
 * Trade-off documented inline: the visible URL becomes `/docs/not-found`
 * (not the original missing slug). Angular SSR ≤20 has no first-class hook
 * to set HTTP status from a component without a route swap; replacing this
 * pattern with a custom token-based status setter is feasible later but
 * non-trivial. For MVP, status correctness wins over URL fidelity.
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
    const title = 'Page not found · LFX Self Serve Documentation';
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
