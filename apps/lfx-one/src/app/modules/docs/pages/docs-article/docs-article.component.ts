// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DOCUMENT, Location } from '@angular/common';
import { Component, computed, ElementRef, HostListener, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DOCS_CANONICAL_ORIGIN } from '@lfx-one/shared/constants';
import type { DocsArticle, DocsSiblingLink } from '@lfx-one/shared/interfaces';
import { isDocsPath } from '@lfx-one/shared/utils';
import { map } from 'rxjs/operators';

import { DocsSearchComponent } from '../../components/docs-search/docs-search.component';
import { DocsManifestService } from '../../services/docs-manifest.service';
import { DocsNotFoundComponent } from '../docs-not-found/docs-not-found.component';

/**
 * Renders one documentation article.
 *
 * Receives the resolved `DocsArticle` from `docsArticleResolver` via
 * `route.data['article']` (T027). The article body — already sanitized and
 * link-rewritten at build time — is bound via `[innerHTML]` inside a
 * `prose-lfx` container (research R12).
 *
 * SEO wiring (T028): `Title`, `Meta` (description, OG, Twitter card), and a
 * `<link rel="canonical">` pointing at the configured production origin
 * (`https://app.lfx.dev`) — driven off `toObservable(article)` with
 * `takeUntilDestroyed()` so head tags stay in sync with every navigation,
 * including client-side article→article transitions where Angular reuses
 * this component instance and `ngOnInit` does not re-fire (FR-013,
 * FR-023). `effect()` would do the same job but the frontend convention
 * checklist reserves it for logging/debugging only — `toObservable` +
 * RxJS pipes is the documented alternative for DOM side effects.
 * The canonical origin is intentionally hard-coded; any future
 * per-environment override would land as a runtime config value.
 *
 * Click interceptor (T028 / research R16): a host-level click listener
 * catches anchor activations inside the sanitized `[innerHTML]` body
 * (`data-testid="docs-article-body"`) whose `href` begins with `/docs/`
 * and routes them via `Router.navigateByUrl()` so cross-links rewritten
 * by `marked-config.mjs` navigate inside the SPA without a full reload.
 * The interceptor is *scoped to the body container* on purpose —
 * framework-rendered anchors (breadcrumb / siblings via `[routerLink]`,
 * search results via `DocsSearchComponent.activate()`) already navigate
 * via Angular's router, so intercepting them at the host level would
 * cause a redundant double `navigateByUrl` to the same URL. External
 * links and in-page anchors (`#section`) fall through to the browser
 * default. Modifier-key clicks (cmd/ctrl/shift/alt) also fall through so
 * "open in new tab" still works.
 */
@Component({
  selector: 'lfx-docs-article',
  standalone: true,
  imports: [RouterLink, DatePipe, DocsSearchComponent, DocsNotFoundComponent],
  templateUrl: './docs-article.component.html',
})
export class DocsArticleComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly docsManifest = inject(DocsManifestService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly location = inject(Location);

  /** Article resolved by `docsArticleResolver`: the `DocsArticle` on a hit, or `null` on a miss (renders the inline not-found view). */
  protected readonly article = this.initArticle();

  /** Sibling articles in the same topic, denormalized for cheap renders. Consumed only by `topicArticles`. */
  private readonly siblings = computed(() => {
    const a = this.article();
    if (!a) return [];
    return a.siblings.map((slug) => this.docsManifest.getArticle(slug)).filter((s): s is DocsArticle => Boolean(s));
  });

  /**
   * The stable "More in this topic" list: every non-landing article in the
   * topic, *including* the one currently in view, so the active page stays in
   * place (highlighted) instead of dropping out of the rail on navigation.
   *
   * The build-time `siblings` list excludes the current article and — on a
   * leaf page — the topic landing (the landing is surfaced by the breadcrumb).
   * We re-insert the current leaf and re-sort so that, for a topic with two or
   * more leaves, the rendered set is identical no matter which leaf is open.
   * Returns `[]` when the article has no peers, hiding the rail — that covers a
   * truly lone article and the single leaf of a one-leaf topic, whose only
   * potential peer (the landing) is filtered out. (A one-leaf topic is thus
   * asymmetric: its landing still lists the leaf, but the leaf shows nothing.
   * No such topic exists today — every `docs/user` topic has two or more
   * leaves.)
   *
   * Each entry is mapped to a `DocsSiblingLink` with its active-state class and
   * `aria-current` value precomputed, so the template needs no per-item method
   * call (`docs/reviews/frontend-checklist.md` §63-81).
   */
  protected readonly topicArticles = computed<DocsSiblingLink[]>(() => {
    const current = this.article();
    const peers = this.siblings();
    if (!current || peers.length === 0) return [];
    const ordered = current.isTopicLanding ? peers : [...peers, current].sort((a, b) => this.byDisplayOrderThenSlug(a, b));
    return ordered.map((entry) => this.toSiblingLink(entry, entry.slug === current.slug));
  });

  public constructor() {
    // SEO sync — re-applies head tags whenever `article()` changes. We
    // deliberately use `toObservable` + `takeUntilDestroyed` rather than
    // `effect()` because the frontend convention checklist reserves `effect()`
    // for logging/debugging (`docs/reviews/frontend-checklist.md` §5). The
    // constructor runs in the component's injection context so
    // `takeUntilDestroyed()` auto-binds the component's `DestroyRef` and
    // tears down the subscription on destroy without us retaining it.
    toObservable(this.article)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.applyMetadata());
  }

  /** Navigates to the previous page in browser history (back button in the top bar). */
  protected goBack(): void {
    this.location.back();
  }

  @HostListener('click', ['$event'])
  protected handleAnchorClick(event: MouseEvent): void {
    const anchor = this.findAnchor(event.target);
    if (!anchor) return;

    // Only intercept clicks inside the sanitized markdown body. Framework
    // anchors (breadcrumb/siblings via [routerLink], search results via
    // DocsSearchComponent.activate()) handle their own SPA navigation and
    // would otherwise get a redundant second `navigateByUrl` call here.
    if (!this.isInsideArticleBody(anchor)) return;

    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const href = anchor.getAttribute('href');
    // Use the shared `isDocsPath` predicate so the SPA-navigation contract
    // here, the auth middleware's public-route regex, and the active-state
    // checks in lens-switcher / docs-sidebar-nav all agree on what counts
    // as a docs URL. A bare `[Docs home](/docs)` from authored markdown is
    // intercepted; non-docs prefixes like `/docs-admin` or `/docsx` are not.
    if (!href || !isDocsPath(href)) {
      return;
    }
    if (anchor.target && anchor.target !== '_self') {
      return;
    }

    event.preventDefault();
    void this.router.navigateByUrl(href);
  }

  /**
   * Mirrors the docs build's sibling sort: `displayOrder` ascending, then slug.
   * The slug tie-break uses raw codepoint comparison (`<`/`>`) to match the
   * build's `sortByDisplayOrderThenAlpha` exactly — `localeCompare` applies
   * locale collation that can differ between the SSR (Node) and browser
   * renders of this same rail, which would reorder identical input.
   */
  private byDisplayOrderThenSlug(a: DocsArticle, b: DocsArticle): number {
    const aOrder = typeof a.displayOrder === 'number' ? a.displayOrder : Number.POSITIVE_INFINITY;
    const bOrder = typeof b.displayOrder === 'number' ? b.displayOrder : Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (a.slug < b.slug) return -1;
    if (a.slug > b.slug) return 1;
    return 0;
  }

  /**
   * Builds a render-ready rail link, precomputing the active-state Tailwind
   * class and `aria-current` value so the template stays method-free.
   */
  private toSiblingLink(article: DocsArticle, isActive: boolean): DocsSiblingLink {
    const base =
      'block rounded-md px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
    const linkClass = isActive ? `${base} bg-blue-50 font-medium text-primary` : `${base} text-gray-700 hover:bg-blue-50 hover:text-primary`;
    return { slug: article.slug, url: article.url, title: article.title, linkClass, ariaCurrent: isActive ? 'page' : null };
  }

  private findAnchor(target: EventTarget | null): HTMLAnchorElement | null {
    let node: Node | null = target instanceof Node ? target : null;
    const root = this.host.nativeElement;
    while (node && node !== root) {
      if (node instanceof HTMLAnchorElement) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  /**
   * True when `anchor` is a descendant of the `[innerHTML]` body container
   * (`data-testid="docs-article-body"`). Looked up live on each click rather
   * than cached because `[innerHTML]` re-renders on every navigation, which
   * would invalidate any held reference.
   */
  private isInsideArticleBody(anchor: HTMLAnchorElement): boolean {
    const body = this.host.nativeElement.querySelector('[data-testid="docs-article-body"]');
    return body instanceof HTMLElement ? body.contains(anchor) : false;
  }

  private applyMetadata(): void {
    const a = this.article();
    if (!a) return;

    const canonical = `${DOCS_CANONICAL_ORIGIN}${a.url}`;
    this.title.setTitle(`${a.title} · LFX Documentation`);
    this.meta.updateTag({ name: 'description', content: a.description });
    this.meta.updateTag({ property: 'og:title', content: a.title });
    this.meta.updateTag({ property: 'og:description', content: a.description });
    this.meta.updateTag({ property: 'og:type', content: 'article' });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: a.title });
    this.meta.updateTag({ name: 'twitter:description', content: a.description });
    this.setCanonical(canonical);
    // The not-found page sets `<meta name="robots" content="noindex">`;
    // clear it on every real article so a stale 404 visit doesn't leave
    // the tag attached to the next client-side navigation.
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

  private initArticle() {
    // `docsArticleResolver` yields `null` on a manifest miss (rendered as the
    // inline not-found view); include it so the signal type matches the resolver.
    return toSignal<DocsArticle | null | undefined>(this.route.data.pipe(map((d): DocsArticle | null => d['article'] ?? null)), { initialValue: undefined });
  }
}
