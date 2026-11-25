// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser, isPlatformServer, PlatformLocation } from '@angular/common';
import { Component, computed, inject, makeStateKey, PLATFORM_ID, REQUEST_CONTEXT, Signal, signal, TransferState } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import {
  SHARE_KIT_EVENTS,
  SHARE_KIT_PLATFORM_LABELS,
  SHARE_KIT_PLATFORM_LIMITS,
  SHARE_KIT_PLATFORMS,
  SHARE_KIT_TAB_LABELS,
  SHARE_KIT_TABS,
} from '@lfx-one/shared/constants';
import {
  ServerRequestContext,
  ShareKitContent,
  ShareKitCopyKind,
  ShareKitGraphic,
  ShareKitGraphicView,
  ShareKitPageState,
  ShareKitPlatform,
  ShareKitPostView,
  ShareKitTab,
  UiTabItem,
} from '@lfx-one/shared/interfaces';
import {
  buildShareKitTrackedUrl,
  composeShareKitPost,
  countShareKitPostLength,
  formatLfxDocumentTitle,
  formatShareKitDateRange,
  formatShareKitDay,
} from '@lfx-one/shared/utils';
import { PlausibleService } from '@services/plausible.service';
import { UserService } from '@services/user.service';
import { AppFooterComponent } from '@shared/components/app-footer/app-footer.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';
import { catchError, distinctUntilChanged, filter, map, of, startWith, switchMap, take, tap } from 'rxjs';

import { ShareKitCopyCardComponent } from '../components/share-kit-copy-card/share-kit-copy-card.component';
import { PublicShareKitService } from '../services/public-share-kit.service';

/** Public event share kit (#6059): copy-ready posts, graphics and a CFP invitation, rendered from repo-owned content. */
@Component({
  selector: 'lfx-share-kit-page',
  imports: [AppFooterComponent, UiButtonComponent, UiSkeletonComponent, UiTabsComponent, ShareKitCopyCardComponent],
  templateUrl: './share-kit-page.component.html',
})
export class ShareKitPageComponent {
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly shareKitService = inject(PublicShareKitService);
  private readonly plausible = inject(PlausibleService);
  private readonly userService = inject(UserService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly platformLocation = inject(PlatformLocation);
  private readonly transferState = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;

  // SSR-resolved state handed to the client so its first paint matches the server DOM on every branch.
  private readonly stateKey = makeStateKey<ShareKitPageState>('shareKitState');

  protected readonly tab = signal<string>('share');
  protected readonly platform = signal<string>('linkedin');

  protected readonly state: Signal<ShareKitPageState> = this.initState();
  protected readonly kit = computed(() => this.state().shareKit);
  protected readonly dates = computed(() => {
    const kit = this.kit();
    return kit ? formatShareKitDateRange(kit.startDate, kit.endDate) : '';
  });
  protected readonly earlyBird = computed(() => {
    const until = this.kit()?.registration.earlyBirdUntil;
    return until ? formatShareKitDay(until) : '';
  });
  protected readonly cfpCloses = computed(() => {
    const closesOn = this.kit()?.cfp?.closesOn;
    return closesOn ? formatShareKitDay(closesOn, true) : '';
  });
  protected readonly tabs: Signal<UiTabItem[]> = this.initTabs();
  protected readonly platformTabs: UiTabItem[] = SHARE_KIT_PLATFORMS.map((value) => ({ value, label: SHARE_KIT_PLATFORM_LABELS[value] }));
  protected readonly graphics: Signal<ShareKitGraphicView[]> = computed(() =>
    // `download` only works for same-origin files: graphics on another host open in a new tab instead.
    (this.kit()?.graphics ?? []).map((graphic) => ({ ...graphic, local: graphic.url.startsWith('/') }))
  );
  protected readonly posts: Signal<ShareKitPostView[]> = this.initPosts();
  protected readonly blurb = computed(() => {
    const kit = this.kit();
    if (!kit) return '';
    const link = buildShareKitTrackedUrl(kit.newsletterBlurb.url, { medium: 'newsletter', campaign: kit.eventSlug, content: 'blurb' });
    return `${kit.newsletterBlurb.text.trim()}\n\nEvent details: ${link}`;
  });
  protected readonly cfpInvitation = computed(() => {
    const kit = this.kit();
    if (!kit?.cfp) return '';
    // The invitation is sent to colleagues, not posted to the platform picked on the Share tab.
    const link = buildShareKitTrackedUrl(kit.cfp.url, { medium: 'cfp', campaign: kit.eventSlug, content: 'cfp-invite' });
    return composeShareKitPost(kit.cfp.invitation, link);
  });
  protected readonly registerUrl = computed(() => this.pageLink(this.kit()?.registration.url, 'register'));
  protected readonly cfpUrl = computed(() => this.pageLink(this.kit()?.cfp?.url, 'cfp-details'));
  protected readonly guideUrl = computed(() => this.pageLink(this.kit()?.cfp?.guide?.url, 'cfp-guide'));

  public constructor() {
    const settled$ = toObservable(this.state).pipe(filter((state) => !state.loading));
    settled$.pipe(takeUntilDestroyed()).subscribe((state) => this.applyMetadata(state.shareKit));
    if (isPlatformBrowser(this.platformId)) {
      // This route defers its pageview (PlausibleService) so it carries the kit's foundation, not the visitor's lens.
      const ready$ = toObservable(this.plausible.ready).pipe(filter(Boolean), take(1));
      settled$
        .pipe(
          distinctUntilChanged((a, b) => a.shareKit?.eventSlug === b.shareKit?.eventSlug),
          switchMap((state) => ready$.pipe(map(() => state.shareKit))),
          takeUntilDestroyed()
        )
        .subscribe((kit) =>
          this.plausible.trackPage(PlausibleService.buildPageviewContext({ foundationSlug: kit?.foundationSlug, foundationName: kit?.foundationName }))
        );
    }
  }

  protected selectPlatform(value: string): void {
    this.platform.set(value);
    this.track(SHARE_KIT_EVENTS.platformTab, { kind: value });
  }

  protected onPostCopied(postId: string): void {
    this.onCopied(this.currentPlatform(), postId);
  }

  protected onCopied(kind: ShareKitCopyKind, post?: string): void {
    this.track(SHARE_KIT_EVENTS.copy, { foundation: this.kit()?.foundationSlug, kind, ...(post ? { post } : {}) });
  }

  protected onRegisterClick(placement: 'hero' | 'footer'): void {
    this.track(SHARE_KIT_EVENTS.registerClick, { foundation: this.kit()?.foundationSlug, signed_in: this.userService.authenticated(), placement });
  }

  protected onCfpClick(link: 'cfp' | 'guide'): void {
    this.track(SHARE_KIT_EVENTS.cfpClick, { foundation: this.kit()?.foundationSlug, link });
  }

  protected onGraphicDownload(graphic: ShareKitGraphic): void {
    this.track(SHARE_KIT_EVENTS.graphicDownload, { foundation: this.kit()?.foundationSlug, label: graphic.label });
  }

  private initState(): Signal<ShareKitPageState> {
    const initial: ShareKitPageState = { loading: true, error: false, notFound: false, shareKit: null };
    const transferred = this.transferState.get(this.stateKey, null);
    if (isPlatformBrowser(this.platformId) && transferred) {
      this.transferState.remove(this.stateKey);
    }
    return toSignal(
      this.activatedRoute.paramMap.pipe(
        map((params) => params.get('eventSlug')),
        filter((slug): slug is string => !!slug),
        distinctUntilChanged(),
        switchMap((slug, index) =>
          this.shareKitService.getShareKit(slug).pipe(
            map((shareKit): ShareKitPageState => ({ loading: false, error: false, notFound: false, shareKit })),
            catchError((err) => {
              if (err?.status === 404) {
                return of<ShareKitPageState>({ loading: false, error: false, notFound: true, shareKit: null });
              }
              console.error('Failed to load share kit', err?.status);
              return of<ShareKitPageState>({ loading: false, error: true, notFound: false, shareKit: null });
            }),
            tap((state) => {
              if (isPlatformServer(this.platformId) && !state.loading) {
                this.transferState.set(this.stateKey, state);
                if (state.notFound && this.reqContext) {
                  this.reqContext.notFound = true;
                }
                // Error HTML is served with a 5xx so crawlers don't index the unavailable page as the kit.
                if (state.error && this.reqContext) {
                  this.reqContext.unavailable = true;
                }
              }
            }),
            startWith(index === 0 && transferred ? transferred : initial)
          )
        )
      ),
      { initialValue: transferred ?? initial }
    );
  }

  private initTabs(): Signal<UiTabItem[]> {
    return computed(() => {
      const kit = this.kit();
      const available: Record<ShareKitTab, boolean> = { share: true, graphics: (kit?.graphics.length ?? 0) > 0, cfp: !!kit?.cfp };
      return SHARE_KIT_TABS.filter((value) => available[value]).map((value) => ({ value, label: SHARE_KIT_TAB_LABELS[value] }));
    });
  }

  private initPosts(): Signal<ShareKitPostView[]> {
    return computed((): ShareKitPostView[] => {
      const kit = this.kit();
      if (!kit) return [];
      const platform = this.currentPlatform();
      const { limit } = SHARE_KIT_PLATFORM_LIMITS[platform];
      return kit.posts.map((post) => {
        const link = buildShareKitTrackedUrl(kit.registration.url, { medium: platform, campaign: kit.eventSlug, content: post.id });
        const text = post.text[platform];
        return { id: post.id, title: post.title, text: composeShareKitPost(text, link), length: countShareKitPostLength(text, link, platform), limit };
      });
    });
  }

  private currentPlatform(): ShareKitPlatform {
    const value = this.platform();
    return SHARE_KIT_PLATFORMS.find((platform) => platform === value) ?? 'linkedin';
  }

  // Buttons on the kit itself are tagged `utm_medium=page` so their clicks are told apart from shared posts.
  private pageLink(url: string | undefined, content: string): string | null {
    const kit = this.kit();
    return url && kit ? buildShareKitTrackedUrl(url, { medium: 'page', campaign: kit.eventSlug, content }) : null;
  }

  private track(event: string, props: Record<string, unknown>): void {
    const kit = this.kit();
    if (!kit) return;
    this.plausible.trackEvent(event, { event_slug: kit.eventSlug, ...props });
  }

  // Request-backed in SSR too, unlike `document.location`, so preview image URLs in the first HTML are absolute and valid.
  private ownOrigin(): string {
    const { protocol, hostname, port } = this.platformLocation;
    return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
  }

  // Title + Open Graph / Twitter tags so a shared kit link unfurls with the event name, tagline and promo image.
  // Canonical, og:url and robots are reset every time, since a client-side visit can arrive with another page's.
  private applyMetadata(kit: ShareKitContent | null): void {
    if (kit) {
      const pageUrl = `${this.ownOrigin()}/events/${kit.eventSlug}/share-kit`;
      this.setCanonical(pageUrl);
      this.meta.updateTag({ property: 'og:url', content: pageUrl });
      this.meta.removeTag('name="robots"');
    } else {
      this.document.querySelector('link[rel="canonical"]')?.remove();
      this.meta.removeTag('property="og:url"');
      this.meta.updateTag({ name: 'robots', content: 'noindex' });
    }

    const name = kit ? `${kit.title} share kit` : 'Event share kit';
    const description = kit?.tagline ?? 'Copy-ready posts and graphics to share an LF event.';
    this.title.setTitle(formatLfxDocumentTitle(name));
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: name });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: 'LFX' });
    this.meta.updateTag({ name: 'twitter:title', content: name });
    this.meta.updateTag({ name: 'twitter:description', content: description });

    const image = kit?.ogImage;
    if (image) {
      const url = image.url.startsWith('/') ? `${this.ownOrigin()}${image.url}` : image.url;
      this.meta.updateTag({ property: 'og:image', content: url });
      this.meta.updateTag({ property: 'og:image:alt', content: image.alt });
      this.meta.updateTag({ name: 'twitter:image', content: url });
      this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    } else {
      this.meta.removeTag('property="og:image"');
      this.meta.removeTag('property="og:image:alt"');
      this.meta.removeTag('name="twitter:image"');
      this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    }
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
