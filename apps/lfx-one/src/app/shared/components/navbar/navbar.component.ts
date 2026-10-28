// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { afterNextRender, afterRenderEffect, Component, computed, ElementRef, inject, Injector, input, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, RouterModule } from '@angular/router';
import { BadgeComponent } from '@components/badge/badge.component';
import { ChangelogDrawerComponent } from '@components/changelog-drawer/changelog-drawer.component';
import { CreateArtifactDialogComponent } from '@components/create-artifact-dialog/create-artifact-dialog.component';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { OrgSelectorComponent } from '@components/org-selector/org-selector.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { environment } from '@environments/environment';
import {
  CREATABLE_ARTIFACTS,
  LINKS_CONFIG,
  NAVBAR_BRAND_SITE,
  NAVBAR_DOCK_MORPH_MS,
  NAVBAR_LENS_OVERRIDES,
  NAVBAR_MORPH_EASING,
  NAVBAR_MORPH_SETTLE_MS,
  NAVBAR_NO_ACCESS_GHOST_ITEMS,
  NAVBAR_PEEK_CLOSE_DELAY_MS,
  NAVBAR_PEEK_MORPH_MS,
  NAVBAR_PEEK_OPEN_DELAY_MS,
  NAVBAR_PEEK_RECHECK_DELAY_MS,
  NAVBAR_ROLE_PREPOSITIONS,
  NAVBAR_ROLE_STYLES,
  BOARD_SCOPED_PERSONAS,
  PERSONA_OPTIONS,
  PERSONA_PRIORITY,
} from '@lfx-one/shared/constants';
import {
  CreatableArtifactConfig,
  Lens,
  LensOption,
  NavbarBrandApp,
  NavbarMenuBlock,
  NavbarMorphFocus,
  NavbarRoleMark,
  NavbarRoleProject,
  NavbarTabIndicator,
  NavTooltipItem,
  NavTooltipPlacement,
  SidebarMenuItem,
} from '@lfx-one/shared/interfaces';
import { buildInsightsUrl, isDocsPath, toTitleCase } from '@lfx-one/shared/utils';
import { AppService } from '@services/app.service';
import { ChangelogService } from '@services/changelog.service';
import { CreatePermissionService } from '@services/create-permission.service';
import { NavbarCollapseService } from '@services/navbar-collapse.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { SidebarNavService } from '@services/sidebar-nav.service';
import { LogoutLinkDirective } from '@shared/directives/logout-link.directive';
import { NavTooltipDirective } from '@shared/directives/nav-tooltip.directive';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Popover, PopoverModule } from 'primeng/popover';
import { filter, pairwise } from 'rxjs';

import { NavMenuBase } from './nav-menu-base.directive';

/**
 * The redesigned LFX navbar (sidebar v2): the 48px lens rail and the 300px nav panel merged into one
 * floating 280px panel — brand row (LF apps menu, Create), lens tabs, context card, lens menu and a
 * footer with the account menu, impersonation, What's New and Documentation.
 *
 * Menu building, active-route highlighting, context switching and the SSR hydration gate come from
 * {@link NavMenuBase}; this component renders them in the navbar markup and folds in the rail actions
 * that used to live in the former lens-switcher rail.
 *
 * The desktop instance also collapses to a 48px rail and peeks open over the page from it
 * ({@link NavbarCollapseService}): one panel that morphs between the two, its header buttons moved
 * with a FLIP animation. The mobile drawer's instance never collapses.
 *
 * Styles are unencapsulated (`lfxn-` prefixed) because the context card is also rendered by the
 * project/org selectors' `navbar` variant, inside their own host elements.
 */
@Component({
  selector: 'lfx-navbar',
  imports: [
    NgClass,
    NgTemplateOutlet,
    RouterModule,
    BadgeComponent,
    ChangelogDrawerComponent,
    OrgSelectorComponent,
    ProjectSelectorComponent,
    PopoverModule,
    LogoutLinkDirective,
    NavTooltipDirective,
    OpenIntercomDirective,
    ScrollShadowDirective,
  ],
  providers: [DialogService],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
  host: {
    class: 'lfxn-host',
    '[class.lfxn-host--dock]': '!mobile()',
    '[class.is-collapsed]': 'railVisible()',
    '[class.is-overlay]': '!mobile() && collapse.overlay()',
    '[class.is-narrow]': '!mobile() && collapse.narrow()',
    '[class.is-pinned]': '!mobile() && collapse.peekPinned()',
    '[class.is-animated]': '!mobile() && collapse.animated()',
  },
})
export class NavbarComponent extends NavMenuBase {
  private readonly dialogService = inject(DialogService);
  private readonly changelogService = inject(ChangelogService);
  private readonly sidebarNavService = inject(SidebarNavService);
  private readonly appService = inject(AppService);
  private readonly orgLensNavigation = inject(OrgLensNavigationService);
  protected readonly createPermissionService = inject(CreatePermissionService);
  protected readonly collapse = inject(NavbarCollapseService);
  private readonly injector = inject(Injector);

  /** Whether the host layout shifts the navbar down to clear the impersonation banner (main layout only). */
  public readonly bannerOffset = input<boolean>(false);

  protected readonly brandMenu = viewChild<Popover>('brandMenu');
  protected readonly createMenu = viewChild<Popover>('createMenu');
  protected readonly userMenu = viewChild<Popover>('userMenu');
  private readonly projectSelector = viewChild(ProjectSelectorComponent);
  private readonly orgSelector = viewChild(OrgSelectorComponent);
  protected readonly brandMenuOpen = signal(false);
  // Popover open state as signals: zoneless, an outside click or Escape closes a popover without
  // re-rendering the trigger, so `overlayVisible` would leave it styled and announced as open.
  protected readonly createMenuOpen = signal(false);
  protected readonly userMenuOpen = signal(false);
  /** Scroll-edge state of the menu body — drives the top/bottom fade masks. */
  protected readonly menuScroll = viewChild(ScrollShadowDirective);
  /** The lens tab group, measured to place the sliding active pill. */
  private readonly lensTabsEl = viewChild<ElementRef<HTMLElement>>('lensTabGroup');
  /** Where the active pill sits; null until measured in the browser (the active tab paints its own pill until then). */
  protected readonly tabIndicator = signal<NavbarTabIndicator | null>(null);

  protected readonly user = this.userService.user;
  protected readonly userInitials = this.userService.userInitials;
  // Hide the role marks when the user is a root-writer — executive-director is spoofed, not naturally detected.
  protected readonly showPersonaBadge: Signal<boolean> = computed(() => !this.personaService.isRootWriter());

  /**
   * The avatar URL that last failed to load. Google profile photos are served with
   * `referrerpolicy="no-referrer"` (they reject requests carrying the page as referrer); if one
   * still fails, the photo slots fall back to initials until the URL changes.
   */
  private readonly failedPhotoUrl = signal<string | null>(null);
  protected readonly photoUrl: Signal<string> = computed(() => {
    const url = this.userService.effectiveAvatarUrl();
    return url && url !== this.failedPhotoUrl() ? url : '';
  });

  // ── Lens tabs ────────────────────────────────────────────────────────────────────────────────
  protected readonly lensTabs: Signal<LensOption[]> = computed(() =>
    this.lensService.displayLenses().map((lens) => ({ ...lens, ...NAVBAR_LENS_OVERRIDES[lens.id] }))
  );
  // The menu's lens, not the page's: in the mobile drawer a tab previews its lens's menu (#4208).
  protected readonly activeLensId = this.lensService.displayMenuLens;
  // A lone tab carries no choice — only render the switcher when the persona can reach more than one lens.
  protected readonly showLensTabs: Signal<boolean> = computed(() => this.lensTabs().length > 1);

  protected readonly selectorSearchPlaceholder: Signal<string> = computed(() => {
    if (this.isHybridPersona()) return 'Search...';
    return this.navLens() === 'foundation' ? 'Search foundations...' : 'Search projects...';
  });
  protected readonly selectorEmptyMessage: Signal<string> = computed(() => {
    if (this.isHybridPersona()) return 'No results found';
    return this.navLens() === 'foundation' ? 'No foundations found' : 'No projects found';
  });

  // ── Menu ─────────────────────────────────────────────────────────────────────────────────────
  protected readonly menuBlocks = computed(() => this.toMenuBlocks(this.itemsWithTestIds()));
  protected readonly footerMenuItems = this.footerItemsWithTestIds;

  /**
   * `'foundation'` / `'project'` when that lens loaded but leaves this user no menu items (their role
   * on the selected context unlocks nothing) — the panel then explains why instead of sitting empty.
   */
  protected readonly showNoAccessState: Signal<'foundation' | 'project' | null> = computed(() => {
    const lens = this.navLens();
    if (!lens || this.itemsWithTestIds().length > 0 || this.footerMenuItems().length > 0) return null;
    // An empty menu only means "no role" once everything that shapes it has resolved — except during a
    // Retry from the error card, which keeps the card (with a busy button) rather than the skeleton.
    if (this.sidebarNavService.sidebarItemsPending() && !this.retryingLookups()) return null;
    return lens;
  });

  /** An empty project/foundation menu still waiting on what shapes it — keep the skeleton, not a blank panel. */
  protected readonly menuPending: Signal<boolean> = computed(
    () => this.navLens() !== null && this.itemsWithTestIds().length === 0 && this.sidebarNavService.sidebarItemsPending() && !this.retryingLookups()
  );

  /**
   * The menu panel has settled enough to show its items or its empty state. The single gate for both the
   * visible panel and its live region, so screen readers never hear a state the panel hasn't shown.
   */
  protected readonly menuStateReady: Signal<boolean> = computed(() => this.hydrated() && this.lensLoaded() && !this.menuPending());

  /** The no-access / lookup-failed state as the live region announces it: only once the visible panel shows it. */
  protected readonly announcedNoAccessState: Signal<'foundation' | 'project' | null> = computed(() =>
    this.menuStateReady() ? this.showNoAccessState() : null
  );

  /** A Retry from the lookup-error card is running: the card stays up, its button busy, until the lookups settle. */
  protected readonly retryingLookups: Signal<boolean> = computed(() => this.sidebarNavService.menuRetryPending());

  /** The empty menu comes from a failed lookup, not a confirmed denial: the card offers a retry instead. */
  protected readonly menuLookupFailed: Signal<boolean> = computed(() => this.sidebarNavService.menuLookupFailed());

  /**
   * A lookup that shapes the menu failed, but the menu still has items (e.g. an unconfirmed marketing grant
   * is the only thing missing): the empty-state card never shows, so an inline row offers the retry instead.
   * Foundation / project lens only, like that card: those lookups don't shape the Home or Org menus.
   */
  protected readonly showPartialLookupFailed: Signal<boolean> = computed(
    () =>
      this.navLens() !== null &&
      this.showNoAccessState() === null &&
      (this.menuLookupFailed() || this.retryingLookups()) &&
      (this.itemsWithTestIds().length > 0 || this.footerMenuItems().length > 0)
  );

  /** The inline retry row as the live region announces it: only once the visible panel shows it. */
  protected readonly announcedPartialLookupFailed: Signal<boolean> = computed(() => this.menuStateReady() && this.showPartialLookupFailed());

  protected readonly noAccessGhostItems = NAVBAR_NO_ACCESS_GHOST_ITEMS;

  // ── Me card ──────────────────────────────────────────────────────────────────────────────────
  protected readonly roleMarks: Signal<NavbarRoleMark[]> = this.initRoleMarks();

  // ── Rail actions ─────────────────────────────────────────────────────────────────────────────
  protected readonly canImpersonate = this.userService.canImpersonate;
  protected readonly isImpersonating = this.userService.impersonating;
  protected readonly unseenChangelogCount = this.changelogService.unseenChangelogCount;
  protected readonly changelogDrawerVisible = signal(false);
  protected readonly changelogAriaLabel = computed(() => {
    const count = this.unseenChangelogCount();
    if (count === 0) return "What's New";
    return `What's New (${count} unseen ${count === 1 ? 'update' : 'updates'})`;
  });
  // Only offer artifact types the user can actually create somewhere (mirrors the Create button's visibility gate).
  protected readonly creatableArtifacts = computed<CreatableArtifactConfig[]>(() =>
    CREATABLE_ARTIFACTS.filter((artifact) => this.createPermissionService.creatableTypes().includes(artifact.type))
  );

  protected readonly brandApps: NavbarBrandApp[] = [
    {
      name: 'LFX Insights',
      blurb: 'Analytics and health metrics for open source projects.',
      url: buildInsightsUrl(),
      icon: 'fa-light fa-chart-simple',
      testId: 'navbar-brand-insights',
    },
    {
      name: 'LFX Crowdfunding',
      blurb: 'Fund the projects you depend on and back the maintainers behind them.',
      url: environment.urls.crowdfunding,
      icon: 'fa-light fa-hand-heart',
      testId: 'navbar-brand-crowdfunding',
    },
    {
      name: 'LFX Mentorship',
      blurb: 'Learn from experienced maintainers and grow a career in open source.',
      url: environment.urls.mentorship,
      icon: 'fa-light fa-chalkboard-user',
      testId: 'navbar-brand-mentorship',
    },
    {
      name: 'LF Events',
      blurb: 'Meet the community at Open Source Summit and 100+ events a year.',
      url: LINKS_CONFIG.EVENTS.DISCOVER,
      icon: 'fa-light fa-ticket',
      testId: 'navbar-brand-events',
    },
  ];
  protected readonly brandSite = NAVBAR_BRAND_SITE;
  /** The Documentation button reads as active anywhere under `/docs`, as the lens rail it replaced did. */
  protected readonly isDocsActive: Signal<boolean> = computed(() => isDocsPath(this.navigatedUrl()));

  // ── Collapse / peek (desktop only) ───────────────────────────────────────────────────────────
  /** The panel shows as the slim rail. */
  protected readonly railVisible: Signal<boolean> = computed(() => !this.mobile() && this.collapse.visualCollapsed());
  /** Docked to the rail (even while peeking): the footer actions then also live in the account menu. */
  protected readonly railDocked: Signal<boolean> = computed(() => !this.mobile() && this.collapse.effectiveCollapsed());
  /** Rail tooltips open beside the trigger; the open panel's below it. */
  protected readonly headTooltipPlacement: Signal<NavTooltipPlacement> = computed(() => (this.railVisible() ? 'right' : 'bottom'));
  /** A peek on a wide viewport docks open on click; otherwise the toggle opens or closes the sidebar. */
  protected readonly toggleLabel: Signal<string> = computed(() => {
    if (this.railVisible()) return 'Open sidebar';
    return this.collapse.peek() ? 'Keep sidebar open' : 'Close sidebar';
  });
  /** A menu or panel opened from the navbar is up: a peek must not close under it. */
  private readonly navbarMenuOpen: Signal<boolean> = computed(
    () => this.brandMenuOpen() || this.createMenuOpen() || this.userMenuOpen() || this.selectorPanelOpen()
  );
  private readonly panelEl = viewChild<ElementRef<HTMLElement>>('panel');
  private peekOpenTimer: ReturnType<typeof setTimeout> | null = null;
  private peekCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private morphSettleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last pointer position seen while peeking; null until the pointer moves (keyboard use never closes a peek). */
  private pointer: { x: number; y: number } | null = null;
  /** The pointer was last over a navbar tooltip — appended to `body`, so it can sit outside the panel it belongs to. */
  private pointerOnTooltip = false;

  public constructor() {
    super();
    // afterNextRender so input bindings have settled — the mobile drawer instance skips the fetch.
    afterNextRender(() => {
      if (!this.mobile()) {
        this.changelogService.loadUnseenCount();
      }
    });
    this.initTabIndicator();
    this.initDrawerCloseCleanup();
    this.initPreviewPickCommit();
    this.initCollapse();
  }

  /**
   * The sidebar toggle: dock open or closed on wide viewports. On narrow ones it pins a peek — from the rail, or the hover
   * peek the pointer just opened on its way to the click — and closes a pinned one. A keyboard press (no click count)
   * keeps focus in the navbar; a pointer click drops it.
   */
  protected onToggleClick(event: MouseEvent): void {
    this.clearPeekOpenTimer();
    const focus: NavbarMorphFocus = event.detail === 0 ? 'keyboard' : 'pointer';
    if (this.collapse.narrow()) {
      this.morph(() => (this.collapse.peekPinned() ? this.collapse.closePeek() : this.collapse.openPeek(true)), focus);
      return;
    }
    if (this.collapse.peek()) {
      // Already as wide as docked: the panel just stops floating, and the page gutter grows under it.
      this.morph(() => this.collapse.setCollapsed(false), focus);
      return;
    }
    this.morph(() => this.collapse.setCollapsed(!this.collapse.collapsed()), focus);
  }

  /** Hovering the rail's toggle peeks the panel open — the only hover that does, so a collapse click never reopens it. */
  protected onToggleEnter(): void {
    if (!this.railVisible() || this.collapse.touch()) return;
    this.clearPeekOpenTimer();
    this.peekOpenTimer = setTimeout(() => {
      this.peekOpenTimer = null;
      if (this.railVisible()) this.morph(() => this.collapse.openPeek());
    }, NAVBAR_PEEK_OPEN_DELAY_MS);
  }

  protected onToggleLeave(): void {
    this.clearPeekOpenTimer();
  }

  /** Jump from a role chip to that project's or foundation's overview (the deep-link route the lens guards resolve). */
  protected openRoleProject(mark: NavbarRoleMark, chip: NavTooltipItem): void {
    const project = mark.projects.find((candidate) => candidate.slug === chip.key);
    if (!project?.lens) return;
    this.router.navigate([`/${project.lens}`, 'overview'], { queryParams: { project: project.slug } });
  }

  protected onPhotoError(url: string): void {
    this.failedPhotoUrl.set(url);
  }

  /**
   * Desktop lens tabs switch the lens and land on its default page. In the mobile drawer a tab only previews that lens's
   * menu, leaving the page and its lens untouched, for the viewer to pick a page from it — or close the drawer (#4208).
   */
  protected switchLens(lens: Lens): void {
    if (this.mobile()) {
      this.lensService.previewMenuLens(lens);
      return;
    }
    this.lensService.switchLens(lens);
  }

  protected toggleBrandMenu(event: Event): void {
    this.brandMenu()?.toggle(event);
  }

  protected toggleCreateMenu(event: Event): void {
    this.createMenu()?.toggle(event);
  }

  protected toggleUserMenu(event: Event): void {
    this.userMenu()?.toggle(event);
  }

  protected navigateToProfile(): void {
    this.userMenu()?.hide();
    this.lensService.setLens('me');
    this.router.navigate(['/profile']);
  }

  protected navigateToProfileSettings(): void {
    this.userMenu()?.hide();
    this.lensService.setLens('me');
    this.router.navigate(['/profile/settings']);
  }

  protected openImpersonationDialog(): void {
    this.userMenu()?.hide();
    this.closePeekForDialog();
    this.dialogService.open(ImpersonationDialogComponent, {
      header: 'Impersonate User',
      width: '400px',
      modal: true,
      draggable: false,
      resizable: false,
    });
  }

  protected openCreateDialog(artifact: CreatableArtifactConfig): void {
    this.createMenu()?.hide();
    this.closePeekForDialog();
    const dialogRef = this.dialogService.open(CreateArtifactDialogComponent, {
      // No PrimeNG header — the dialog body renders its own "Create <Type>" header.
      showHeader: false,
      width: '480px',
      contentStyle: { padding: '1.5rem' },
      modal: true,
      draggable: false,
      resizable: false,
      dismissableMask: true,
      data: { type: artifact.type },
    }) as DynamicDialogRef;

    nameDynamicDialog(this.dialogService, dialogRef, CreateArtifactDialogComponent.headingId);
  }

  protected retryMenu(): void {
    this.sidebarNavService.retryMenuLookups();
  }

  protected closeMobileDrawer(): void {
    this.appService.closeMobileSidebar();
  }

  /**
   * An organization picked while the drawer previews Org Lens from another lens's page commits Org Lens and lands on that
   * organization's overview (#4208): off an Org page the selector re-addresses nothing by itself. Without a preview the
   * selector has already re-addressed the page, possibly with `replaceUrl`, which the layout leaves alone — so the pick
   * closes the mobile drawer itself.
   */
  protected onOrgSelected(): void {
    if (!this.lensService.previewingMenuLens()) {
      this.closeMobileDrawer();
      // The same `replaceUrl` re-addressing leaves a pinned peek open, so the pick closes it too.
      if (!this.mobile() && this.collapse.peekPinned()) this.morph(() => this.collapse.closePeek(), 'none');
      return;
    }
    this.lensService.commitMenuLens();
    void this.router.navigate(this.orgLensNavigation.orgLensLink('overview'));
  }

  protected openChangelogDrawer(): void {
    this.userMenu()?.hide();
    this.closePeekForDialog();
    this.changelogDrawerVisible.set(true);
  }

  protected navigateToDocs(): void {
    this.userMenu()?.hide();
    this.router.navigate(['/docs']);
  }

  /**
   * Keeps the sliding pill under the active lens tab: re-measured after every render that changes the
   * active lens or the tab set, and whenever the group resizes (the mobile drawer's copy is measured
   * as 0px wide until the drawer opens). Browser-only — render hooks never run during SSR.
   */
  private initTabIndicator(): void {
    let observed: HTMLElement | null = null;
    let observer: ResizeObserver | null = null;
    const measure = (group: HTMLElement): void => {
      const active = group.querySelector<HTMLElement>('.lfxn__tab.is-active');
      this.tabIndicator.set(active && active.offsetWidth > 0 ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };

    afterRenderEffect(() => {
      this.activeLensId();
      this.lensTabs();
      const group = this.lensTabsEl()?.nativeElement ?? null;
      if (group !== observed) {
        observer?.disconnect();
        observed = group;
        observer = group && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure(group)) : null;
        if (group) observer?.observe(group);
      }
      if (group) measure(group);
    });
    this.destroyRef.onDestroy(() => observer?.disconnect());
  }

  /**
   * Desktop only: restores the stored preference, then keeps a peek honest — it closes once the pointer has left the
   * panel (tracked by position, since `:hover` goes stale after a popover or dialog closes), after an outside click or
   * focus leaving it when pinned, on Escape, or on a navigation from a pinned peek — but never while a menu or panel
   * opened from it is still up.
   */
  private initCollapse(): void {
    afterNextRender(() => {
      if (this.mobile()) return;
      this.collapse.init();
      const doc = this.elementRef.nativeElement.ownerDocument;
      const panel = this.panelEl()?.nativeElement;

      const onMove = (event: MouseEvent): void => {
        this.pointer = { x: event.clientX, y: event.clientY };
        this.pointerOnTooltip = event.target instanceof Element && !!event.target.closest('.lfxn-tooltip');
        if (!this.collapse.peek() || this.collapse.peekPinned()) return;
        if (this.peekInUse()) this.clearPeekCloseTimer();
        // Started once per leave: further movement outside must not keep pushing the close back.
        else if (!this.peekCloseTimer) this.schedulePeekClose(NAVBAR_PEEK_CLOSE_DELAY_MS);
      };
      const onLeaveWindow = (): void => {
        this.pointer = { x: -1, y: -1 };
        this.pointerOnTooltip = false;
        if (this.collapse.peek() && !this.collapse.peekPinned()) this.schedulePeekClose(NAVBAR_PEEK_CLOSE_DELAY_MS);
      };
      const onDown = (event: MouseEvent): void => {
        if (!this.collapse.peekPinned() || this.navbarMenuOpen()) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target && (panel?.contains(target) || target.closest('.lfxn-tooltip'))) return;
        this.morph(() => this.collapse.closePeek());
      };
      // An open navbar tooltip takes the first Escape (an interactive role card returns focus to its trigger); the next
      // one closes the peek.
      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || !this.collapse.peek() || this.navbarMenuOpen() || doc.querySelector('.lfxn-tooltip')) return;
        this.morph(() => this.collapse.closePeek(), 'keyboard');
      };
      // Tabbing out of a pinned peek must not leave the overlay over the page content that now holds focus.
      // A hover peek that keyboard focus was holding open re-checks the pointer once focus leaves it.
      const onFocusOut = (event: FocusEvent): void => {
        const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        if (!this.collapse.peek() || this.navbarMenuOpen()) return;
        if (next && (panel?.contains(next) || next.closest('.lfxn-tooltip, .p-popover'))) return;
        if (!this.collapse.peekPinned()) this.schedulePeekClose(NAVBAR_PEEK_CLOSE_DELAY_MS);
        else if (next) this.morph(() => this.collapse.closePeek(), 'none');
      };

      doc.addEventListener('mousemove', onMove, { passive: true });
      doc.documentElement.addEventListener('mouseleave', onLeaveWindow);
      doc.addEventListener('mousedown', onDown, true);
      doc.addEventListener('keydown', onKey);
      panel?.addEventListener('focusout', onFocusOut);
      this.destroyRef.onDestroy(() => {
        doc.removeEventListener('mousemove', onMove);
        doc.documentElement.removeEventListener('mouseleave', onLeaveWindow);
        doc.removeEventListener('mousedown', onDown, true);
        doc.removeEventListener('keydown', onKey);
        panel?.removeEventListener('focusout', onFocusOut);
        this.collapse.resetPeek();
      });
    });

    this.destroyRef.onDestroy(() => {
      this.clearPeekOpenTimer();
      this.clearPeekCloseTimer();
      if (this.morphSettleTimer) clearTimeout(this.morphSettleTimer);
    });

    // A pick from a peek navigates under it: close it, so the overlay doesn't cover the page just opened — a pinned peek
    // or a hover peek (keyboard focus on the picked link holds one open, see peekInUse). As with the mobile drawer, only
    // a navigation the viewer made counts — a page rewriting its own address in place (`replaceUrl`, e.g. Org Lens
    // writing in the default organization) would snap a just-opened peek shut; back/forward still closes it. Focus on
    // the link the rail now hides moves to the toggle (the railVisible subscription below).
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd && this.collapse.peek()),
        filter(() => {
          const navigation = this.router.currentNavigation();
          return !navigation?.extras.replaceUrl || navigation.trigger === 'popstate';
        }),
        takeUntilDestroyed()
      )
      .subscribe(() => this.morph(() => this.collapse.closePeek(), 'none'));

    // A menu or panel opened from a hover peek just closed: give the pointer a moment, then close if it is outside.
    toObservable(this.navbarMenuOpen)
      .pipe(
        pairwise(),
        filter(([wasOpen, open]) => wasOpen && !open && this.collapse.peek() && !this.collapse.peekPinned()),
        takeUntilDestroyed()
      )
      .subscribe(() => this.schedulePeekClose(NAVBAR_PEEK_RECHECK_DELAY_MS));

    // The rail can also come from the viewport crossing the narrow breakpoint (a resize, a zoom) rather than a morph:
    // a navbar control holding focus may be about to hide, so focus moves to one the rail still shows.
    toObservable(this.railVisible)
      .pipe(
        pairwise(),
        filter(([wasRail, rail]) => !wasRail && rail),
        takeUntilDestroyed()
      )
      .subscribe(() => afterNextRender(() => this.keepFocusOnRail(), { injector: this.injector }));
  }

  private initRoleMarks(): Signal<NavbarRoleMark[]> {
    return computed(() => {
      // Hidden for root-writers — executive-director is spoofed for them, not naturally detected.
      if (!this.showPersonaBadge()) return [];
      const personaProjects = this.personaService.personaProjects();
      // Detection defaults every project to `isFoundation: false`; only a tier enrichment actually
      // resolved counts. Before enrichment, or for a project the metadata batch missed, the role's own
      // scope decides instead.
      const foundationByUid = new Map(
        this.personaService
          .detectedProjects()
          .filter((project) => project.tierResolved)
          .map((project) => [project.projectUid, project.isFoundation])
      );
      const priority = new Map(PERSONA_PRIORITY.map((persona, index) => [persona, index]));
      const allowed = new Set(this.lensService.availableLenses().map((option) => option.id));
      return [...this.personaService.allPersonas()]
        .sort((a, b) => (priority.get(a) ?? Number.MAX_SAFE_INTEGER) - (priority.get(b) ?? Number.MAX_SAFE_INTEGER))
        .slice(0, 3)
        .map((persona) => {
          const label = PERSONA_OPTIONS.find((option) => option.value === persona)?.label ?? toTitleCase(persona);
          const projects: NavbarRoleProject[] = (personaProjects[persona] ?? []).map((project) => {
            // The role's own entry carries no tier; take it from detection, else from the role's scope.
            const isFoundation = foundationByUid.get(project.projectUid) ?? BOARD_SCOPED_PERSONAS.has(persona);
            return {
              uid: project.projectUid,
              slug: project.projectSlug,
              name: project.projectName || project.projectSlug,
              isFoundation,
              lens: this.roleProjectLens(isFoundation, allowed),
            };
          });
          // A project the viewer has no lens for stays listed, as a label: navigating would land on a lens
          // the layout can't activate, which renders the Home dashboard under a project URL.
          const chips: NavTooltipItem[] = projects.map((project) =>
            project.lens ? { key: project.slug, label: project.name } : { key: project.slug, label: project.name, static: true }
          );
          const ariaLabel = projects.length ? `Role: ${label} (${projects.map((project) => project.name).join(', ')})` : `Role: ${label}`;
          const title = projects.length ? `${label} ${NAVBAR_ROLE_PREPOSITIONS[persona]}` : label;
          return { ...NAVBAR_ROLE_STYLES[persona], persona, label, title, projects, chips, ariaLabel };
        });
    });
  }

  /**
   * The mobile drawer keeps its navbar alive through the close animation, and the popovers (the context
   * selectors' panels included) and tooltips are appended to `body` — so they would float over the page until the drawer finishes. Close them as
   * soon as the drawer starts closing.
   */
  private initDrawerCloseCleanup(): void {
    toObservable(this.appService.showMobileSidebar)
      .pipe(
        filter((open) => !open && this.mobile()),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.brandMenu()?.hide();
        this.createMenu()?.hide();
        this.userMenu()?.hide();
        this.projectSelector()?.closePanel();
        this.orgSelector()?.closePanel();
        NavTooltipDirective.hideWithin(this.elementRef.nativeElement);
        // Closed without a pick (X, backdrop, Escape): the preview is dropped and the page keeps its lens (#4208).
        this.lensService.clearMenuLensPreview();
      });
    // A navigation to another layout (the Docs link) destroys this navbar before the drawer reports closing, and the
    // preview lives in a root service: drop it here too, so it cannot outlive the drawer that showed it.
    this.destroyRef.onDestroy(() => {
      if (this.mobile()) this.lensService.clearMenuLensPreview();
    });
  }

  /**
   * A page link followed from a previewed lens's menu commits that lens before the router runs its guards, several of
   * which read `activeLens` (#4208). RouterLink starts the navigation from its own click listener, which runs before any
   * template listener on the same anchor, so this listens in the capture phase on the navbar instead. Modified clicks
   * open a new tab and leave this one, and its lens, as they are.
   */
  private initPreviewPickCommit(): void {
    afterNextRender(() => {
      const host = this.elementRef.nativeElement;
      const commitOnPick = (event: MouseEvent): void => {
        if (!this.lensService.previewingMenuLens() || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const link = event.target instanceof Element ? event.target.closest('a.lfxn__item, a.lfxn__me-action') : null;
        if (link && host.contains(link) && link.getAttribute('href')?.startsWith('/')) {
          this.lensService.commitMenuLens();
        }
      };
      host.addEventListener('click', commitOnPick, true);
      this.destroyRef.onDestroy(() => host.removeEventListener('click', commitOnPick, true));
    });
  }

  /** Create, Impersonate and What's New open over the page: the peek closes with them, leaving the rail under the backdrop. */
  private closePeekForDialog(): void {
    if (!this.mobile() && this.collapse.peek()) this.morph(() => this.collapse.closePeek(), 'none');
  }

  private schedulePeekClose(delay: number): void {
    this.clearPeekCloseTimer();
    this.peekCloseTimer = setTimeout(() => {
      this.peekCloseTimer = null;
      if (!this.collapse.peek() || this.collapse.peekPinned() || this.navbarMenuOpen() || this.peekInUse()) return;
      this.morph(() => this.collapse.closePeek());
    }, delay);
  }

  /**
   * The peek is still in use: the pointer is over the panel or one of its tooltips (an interactive role card can reach
   * past the panel), a tooltip holds focus, or keyboard focus is inside the panel (a click leaves focus behind without
   * `:focus-visible`, which must not hold the peek). Keyboard-only use leaves no pointer position, which counts as
   * inside, so only a pointer that left closes the peek.
   */
  private peekInUse(): boolean {
    const panel = this.panelEl()?.nativeElement;
    if (!panel || !this.pointer || this.pointerOnTooltip) return true;
    const active = panel.ownerDocument.activeElement;
    if (active?.closest('.lfxn-tooltip')) return true;
    if (active && panel.contains(active) && active.matches(':focus-visible')) return true;
    const rect = panel.getBoundingClientRect();
    const { x, y } = this.pointer;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  /**
   * Applies a collapse-state change as one morph: the panel's widths and fades are CSS transitions, but the header
   * buttons swap between a row and a column, so they FLIP from where they were to where they land. Also closes the
   * open tooltip, settles focus as `focus` says, and re-fits width-measuring page layouts once the morph settles.
   */
  private morph(change: () => void, focus: NavbarMorphFocus = 'pointer'): void {
    const host = this.elementRef.nativeElement;
    const wasRail = this.collapse.visualCollapsed();
    const wasDockedCollapsed = this.collapse.effectiveCollapsed();
    const before = new Map<string, DOMRect>();
    host.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width && el.dataset['flip']) before.set(el.dataset['flip'], rect);
    });

    change();
    NavTooltipDirective.hideWithin(host);
    const active = host.ownerDocument.activeElement;
    if (focus === 'pointer' && active instanceof HTMLElement && host.contains(active)) active.blur();

    const view = host.ownerDocument.defaultView;
    if (this.collapse.effectiveCollapsed() !== wasDockedCollapsed) {
      // Pages that size themselves from window resizes would otherwise keep the width measured mid-morph. One per burst.
      if (this.morphSettleTimer) clearTimeout(this.morphSettleTimer);
      this.morphSettleTimer = setTimeout(() => {
        this.morphSettleTimer = null;
        view?.dispatchEvent(new Event('resize'));
      }, NAVBAR_MORPH_SETTLE_MS);
    }
    const flip = this.collapse.visualCollapsed() !== wasRail && this.collapse.animated() && !view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!flip && focus !== 'keyboard') return;

    const duration = this.collapse.overlay() ? NAVBAR_PEEK_MORPH_MS : NAVBAR_DOCK_MORPH_MS;
    afterNextRender(
      () => {
        if (focus === 'keyboard') this.settleKeyboardFocus();
        if (!flip) return;
        host.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
          const from = el.dataset['flip'] ? before.get(el.dataset['flip']) : undefined;
          const to = el.getBoundingClientRect();
          if (!from || !to.width || typeof el.animate !== 'function') return;
          el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], {
            duration,
            easing: NAVBAR_MORPH_EASING,
          });
        });
      },
      { injector: this.injector }
    );
  }

  /**
   * After a keyboard-driven change, keep focus on a control the new state still shows: on the rail, the rail's own
   * controls (else the toggle); open, where it was — or, when the toggle is hidden (a narrow peek), the brand button.
   */
  private settleKeyboardFocus(): void {
    const host = this.elementRef.nativeElement;
    const active = host.ownerDocument.activeElement;
    const toggle = host.querySelector<HTMLElement>('[data-flip="side"]');
    const toggleShown = !!toggle && toggle.getClientRects().length > 0;
    const focused = active instanceof HTMLElement && host.contains(active) ? active : null;
    if (this.collapse.visualCollapsed()) {
      if (!focused) toggle?.focus();
      else this.keepFocusOnRail();
      return;
    }
    if (focused && (focused !== toggle || toggleShown)) return;
    if (toggleShown) toggle?.focus();
    else host.querySelector<HTMLElement>('.lfxn__brand')?.focus();
  }

  /** Focus inside the navbar that sits on something the rail hides moves to the rail's toggle; focus elsewhere stays. */
  private keepFocusOnRail(): void {
    const host = this.elementRef.nativeElement;
    const active = host.ownerDocument.activeElement;
    if (!(active instanceof HTMLElement) || !host.contains(active)) return;
    if (active.closest('.lfxn__brand, .lfxn__head-actions > *, .lfxn__user')) return;
    host.querySelector<HTMLElement>('[data-flip="side"]')?.focus();
  }

  private clearPeekOpenTimer(): void {
    if (this.peekOpenTimer) clearTimeout(this.peekOpenTimer);
    this.peekOpenTimer = null;
  }

  private clearPeekCloseTimer(): void {
    if (this.peekCloseTimer) clearTimeout(this.peekCloseTimer);
    this.peekCloseTimer = null;
  }

  /**
   * The lens a role chip opens its project in. A foundation opens in the Foundation lens when the viewer
   * has it; otherwise — and for any non-foundation project — in the Project lens, as the selector shows
   * it. `null` when the viewer has neither, so the chip is not a link.
   */
  private roleProjectLens(isFoundation: boolean, allowed: ReadonlySet<Lens>): Lens | null {
    if (isFoundation && allowed.has('foundation')) return 'foundation';
    return allowed.has('project') ? 'project' : null;
  }

  /**
   * Splits the flat sidebar item list into the navbar's spaced blocks: each section is its own block,
   * and every run of top-level items between sections is one block — a new run starts at an item
   * flagged `dividerBefore`, which draws the dashed rule above it.
   */
  private toMenuBlocks<T extends SidebarMenuItem & { trackKey: string; items?: T[] }>(items: T[]): NavbarMenuBlock<T>[] {
    const blocks: NavbarMenuBlock<T>[] = [];
    let run: NavbarMenuBlock<T> | null = null;
    for (const item of items) {
      if (item.isSection) {
        run = null;
        blocks.push({ key: item.trackKey, ruleBefore: !!item.dividerBefore, section: item, items: item.items ?? [] });
        continue;
      }
      if (!run || item.dividerBefore) {
        run = { key: item.trackKey, ruleBefore: !!item.dividerBefore && blocks.length > 0, section: null, items: [] };
        blocks.push(run);
      }
      run.items.push(item);
    }
    return blocks;
  }
}
