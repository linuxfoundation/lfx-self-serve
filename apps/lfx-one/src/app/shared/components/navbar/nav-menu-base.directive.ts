// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, computed, DestroyRef, Directive, ElementRef, inject, input, model, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import type { IsActiveMatchOptions } from '@angular/router';
import { environment } from '@environments/environment';
import { FORMATION_CHECKLIST_PATH, LENS_DEFAULT_ROUTES } from '@lfx-one/shared/constants';
import { LensItem, NavLens, ProjectContext, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { lensItemToProjectContext, orgLensDestinationKey } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { GwEmbedWarmupService } from '@services/gw-embed-warmup.service';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { filter, map } from 'rxjs';

/** `SidebarMenuItem` as rendered: derived test id, external-link flag and `@for` track key filled in at every level. */
type DecoratedSidebarMenuItem = Omit<SidebarMenuItem, 'items'> & {
  testId: string;
  trackKey: string;
  external: boolean | undefined;
  activeMatchOptions: IsActiveMatchOptions;
  items?: DecoratedSidebarMenuItem[];
};

/**
 * The lens menu's behaviour, kept apart from the navbar's markup: item decoration (test ids, track keys,
 * active-route matching), group expansion, the SSR hydration gate and project / foundation context
 * switching. Abstract and selector-less; {@link NavbarComponent} is the one component that renders it.
 */
@Directive()
export abstract class NavMenuBase {
  private readonly projectContextService = inject(ProjectContextService);
  protected readonly personaService = inject(PersonaService);
  protected readonly lensService = inject(LensService);
  private readonly navigationService = inject(NavigationService);
  protected readonly router = inject(Router);
  protected readonly userService = inject(UserService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly gwEmbedWarmup = inject(GwEmbedWarmupService);
  protected readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly destroyRef = inject(DestroyRef);

  private static readonly exactPathMatch: IsActiveMatchOptions = { paths: 'exact', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored' };
  private static readonly subpathMatch: IsActiveMatchOptions = { ...NavMenuBase.exactPathMatch, paths: 'subset' };

  public readonly items = input.required<SidebarMenuItem[]>();
  public readonly footerItems = input<SidebarMenuItem[]>([]);
  public readonly showProjectSelector = input<boolean>(false);
  /** Parent lens hint for the org-selector slot; ANDed with the grants/seeds gate to produce `effectiveShowOrgSelector` (spec 020 D-005). */
  public readonly showOrgSelector = input<boolean>(false);
  public readonly showMeSelector = input<boolean>(false);
  public readonly mobile = input<boolean>(false);
  public readonly selectorPanelOpen = model<boolean>(false);

  /** Final org-selector visibility — `parent input ∧ (writers ∨ auditors ∨ personaSeeds)` per research.md D-005. */
  protected readonly effectiveShowOrgSelector: Signal<boolean> = this.initEffectiveShowOrgSelector();

  protected readonly activeLens = this.lensService.activeLens;
  protected readonly isOrgLens = computed(() => this.activeLens() === 'org');
  protected readonly isHybridPersona = this.lensService.isHybridPersona;
  protected readonly selectedProject: Signal<ProjectContext | null> = computed(() => this.projectContextService.activeContext());
  // Carried on every nav item's routerLink so switching tabs (Meetings, Groups, Mailing Lists, ...)
  // keeps ?project= in the URL instead of silently dropping it (LFXV2-2837). Gated on the route's
  // declared lens rather than just checking selectedProject — activeContext() falls back to the
  // cookie-restored selection on Me/Org lenses too, which would otherwise leak a foundation/project
  // slug into unrelated Me/Org navigation (e.g. /meetings, /org/overview).
  protected readonly projectQueryParams: Signal<{ project?: string }> = computed(() => {
    const kind = this.projectContextService.activeRouteLensKind();
    if (kind !== 'foundation' && kind !== 'project') return {};
    const slug = this.selectedProject()?.slug;
    return slug ? { project: slug } : {};
  });
  protected readonly navLens: Signal<NavLens | null> = this.initNavLens();
  protected readonly lensLoaded: Signal<boolean> = this.initLensLoaded();

  // Browser-only hydration gate. Org-lens menu items are still shaped by browser-only LaunchDarkly
  // flags (ROI, EasyCLA M3), so the server menu can differ from the client-resolved one; hydrating
  // one against the other leaves stale nodes on screen. Holding the concrete menu back until
  // afterNextRender means the server and the first client render both show the loading skeleton
  // (skeleton→skeleton reconciles cleanly), then the real menu is inserted as a post-hydration update.
  protected readonly hydrated = signal(false);

  protected readonly itemsWithTestIds = computed(() => this.items().map((item) => this.decorate(item)));

  protected readonly footerItemsWithTestIds = computed(() => this.footerItems().map((item) => this.decorate(item)));

  protected readonly navigatedUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  /**
   * `true` by track key for each item with `activeAliases` that the current address highlights. Those items
   * are highlighted here rather than by `routerLinkActive`, which only knows the item's own link:
   * left to both, `routerLinkActive` would strip the classes this adds on every navigation.
   */
  protected readonly aliasHighlightedKeys: Signal<Readonly<Record<string, boolean>>> = this.initAliasHighlightedKeys();

  // Paired with items ref so lens switches auto-reset group expansion without needing an effect().
  private readonly expandedGroupOverrides = signal<{ itemsRef: SidebarMenuItem[]; overrides: Record<string, boolean> }>({
    itemsRef: [],
    overrides: {},
  });

  protected readonly expandedGroupStates = computed(() => {
    const items = this.items();
    const { itemsRef, overrides } = this.expandedGroupOverrides();
    const effectiveOverrides = itemsRef === items ? overrides : {};
    const states: Record<string, boolean> = {};
    // Group expansion is keyed by item.label — group labels must be unique within a single menu items tree.
    const scanForGroups = (candidates: SidebarMenuItem[]) => {
      for (const item of candidates) {
        if (item.isGroup) {
          states[item.label] = item.label in effectiveOverrides ? effectiveOverrides[item.label] : (item.expanded ?? true);
        } else if (item.isSection && item.items?.length) {
          scanForGroups(item.items);
        }
      }
    };
    scanForGroups(items);
    return states;
  });

  public constructor() {
    // Runs browser-only, after the first client render is committed — flips the menu from skeleton to
    // the client-resolved lens menu once hydration is safely past the SSR/CSR reconciliation boundary.
    afterNextRender(() => {
      this.hydrated.set(true);
      // Hovering or focusing the Newsletters link that opens the Gatewaze embed starts its session
      // mint and its connection early (GwEmbedWarmupService). Browser-only, like this callback.
      this.gwEmbedWarmup.watchNavIntent(this.elementRef.nativeElement, this.destroyRef);
    });
  }

  protected toggleGroup(label: string): void {
    const items = this.items();
    const current = this.expandedGroupStates()[label] ?? true;
    const prev = this.expandedGroupOverrides();
    const baseOverrides = prev.itemsRef === items ? prev.overrides : {};
    this.expandedGroupOverrides.set({ itemsRef: items, overrides: { ...baseOverrides, [label]: !current } });
  }

  protected onItemSelected(item: LensItem): void {
    const context = lensItemToProjectContext(item);
    // Project-only users still see foundations in their project list (NavigationService only filters
    // foundations out when the foundation lens is visible). Treat a foundation row as a project context
    // for those users — setLens('foundation') would be a no-op and the selection would silently fail.
    const foundationAllowed = this.lensService.availableLenses().some((option) => option.id === 'foundation');
    const asFoundation = item.isFoundation && foundationAllowed;
    this.lensService.setLens(asFoundation ? 'foundation' : 'project');
    // Decide the navigation before the context syncs the URL: a navigation owns the destination, so
    // the switch must not also `replaceState` the current history entry — that rewrote the page the
    // user came from to the new slug, and Back then landed on a URL the landing-page guards bounce
    // forward (Bugbot on #2757). Only a switch that keeps the page syncs `?project=` in place.
    const target = this.contextSwitchTarget();
    if (asFoundation) {
      this.projectContextService.setFoundation(context, target === null);
    } else {
      this.projectContextService.setProject(context, target === null);
    }
    if (target) {
      this.router.navigate([`/${target}`, 'overview'], { queryParams: { project: context.slug } });
    }
  }

  /**
   * The lens whose overview a context switch must navigate to, or `null` when the switch keeps the
   * current page and only re-targets it. Keeps the URL's lens prefix in sync with the selected
   * context so a hard refresh restores it (syncLensFromRoute + projectQueryParamGuard): navigate on a
   * lens-type change, off an entity page, or off the Project lens landing/checklist pages.
   */
  private contextSwitchTarget(): NavLens | null {
    // Primary-outlet segments, not a split of the raw URL: `Router.url` serializes `path?query#fragment`,
    // so a fragment with no query string would otherwise stay glued to the last segment (same
    // approach as `MentorPageComponent.resolveActiveTab`).
    const segments = this.router.parseUrl(this.router.url).root.children['primary']?.segments.map((segment) => segment.path) ?? [];
    const currentPrefix = segments[0];
    if (currentPrefix !== 'project' && currentPrefix !== 'foundation') {
      return null;
    }
    // activeLens() reflects setLens() synchronously, clamped to what the persona may use.
    const targetLens: NavLens = this.activeLens() === 'foundation' ? 'foundation' : 'project';
    const lensTypeChanged = currentPrefix !== targetLens;
    const onEntityPage = segments.length === 3;
    // The Project lens landing page is decided per project by `formationOverviewRedirectGuard`
    // (#2754): a formation-stage project lands on its checklist, anything else on the dashboard. A
    // same-lens switch otherwise keeps the page and only rewrites `?project=` (`Location.replaceState`,
    // which never re-runs guards), so on the two pages that decision owns, re-enter the lens through
    // a real navigation and let the guard choose again for the new project.
    const currentPath = `/${segments.join('/')}`;
    const onLandingDecisionPage = targetLens === 'project' && (currentPath === LENS_DEFAULT_ROUTES.project || currentPath === FORMATION_CHECKLIST_PATH);
    return lensTypeChanged || onEntityPage || onLandingDecisionPage ? targetLens : null;
  }

  private initEffectiveShowOrgSelector(): Signal<boolean> {
    return computed<boolean>(() => {
      if (!this.showOrgSelector()) return false;
      // Direct writer/auditor grants or a persona-seeded org list. The persona-seeds fallback keeps
      // the selector visible for users on dev sandbox accounts that have a seeded org list but no
      // settings-doc grants in the upstream b2b_org_settings docs.
      return this.accountContextService.hasOrgSelectorAccess();
    });
  }

  private initNavLens(): Signal<NavLens | null> {
    return computed(() => {
      const lens = this.activeLens();
      return lens === 'foundation' || lens === 'project' ? lens : null;
    });
  }

  private initLensLoaded(): Signal<boolean> {
    return computed(() => {
      if (this.isOrgLens()) return true;
      const lens = this.navLens();
      if (!lens) return true;
      return this.navigationService.loaded(lens)();
    });
  }

  private initAliasHighlightedKeys(): Signal<Readonly<Record<string, boolean>>> {
    return computed(() => {
      this.navigatedUrl();
      const keys: Record<string, boolean> = {};
      const scan = (items: DecoratedSidebarMenuItem[]): void => {
        for (const item of items) {
          const links = item.routerLink && item.activeAliases?.length ? [item.routerLink, ...item.activeAliases] : [];
          if (links.some((link) => this.router.isActive(link, item.activeMatchOptions))) keys[item.trackKey] = true;
          if (item.items) scan(item.items);
        }
      };
      scan(this.itemsWithTestIds());
      scan(this.footerItemsWithTestIds());
      return keys;
    });
  }

  /** Test id, external-link flag and `@for` track key for an item and, recursively, its children. */
  private decorate(item: SidebarMenuItem): DecoratedSidebarMenuItem {
    return {
      ...item,
      testId: item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
      trackKey: this.trackKey(item),
      external: item.url ? this.isExternalUrl(item.url) : undefined,
      activeMatchOptions: item.activeOnSubpaths ? NavMenuBase.subpathMatch : NavMenuBase.exactPathMatch,
      items: item.items?.map((childItem) => this.decorate(childItem)),
    };
  }

  /**
   * Stable per-destination identity for the `@for` loops. The destination, not the address: Org Lens
   * links carry the selected organization (`/org/{segment}/{page}`, spec 050), so tracking by the
   * raw `routerLink` would key every row on the organization and a switch would tear down and
   * rebuild the whole nav — re-baking every Font Awesome icon on the way — when only the hrefs moved.
   */
  private trackKey(item: SidebarMenuItem): string {
    return item.routerLink ? orgLensDestinationKey(item.routerLink) : (item.url ?? item.label);
  }

  private isExternalUrl(url: string): boolean {
    if (!url) {
      return false;
    }

    if (url.startsWith('/')) {
      return false;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      return !url.startsWith(environment.urls.home);
    }

    return false;
  }
}
