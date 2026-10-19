// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { afterNextRender, afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, input, Signal, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { BadgeComponent } from '@components/badge/badge.component';
import { ChangelogDrawerComponent } from '@components/changelog-drawer/changelog-drawer.component';
import { CreateArtifactDialogComponent } from '@components/create-artifact-dialog/create-artifact-dialog.component';
import { ImpersonationDialogComponent } from '@components/impersonation-dialog/impersonation-dialog.component';
import { OrgSelectorComponent } from '@components/org-selector/org-selector.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { SidebarComponent } from '@components/sidebar/sidebar.component';
import { environment } from '@environments/environment';
import {
  CREATABLE_ARTIFACTS,
  LINKS_CONFIG,
  NAVBAR_BRAND_SITE,
  NAVBAR_LENS_OVERRIDES,
  NAVBAR_NO_ACCESS_GHOST_ITEMS,
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
  NavbarRoleMark,
  NavbarRoleProject,
  NavbarTabIndicator,
  NavTooltipItem,
  SidebarMenuItem,
} from '@lfx-one/shared/interfaces';
import { buildInsightsUrl, toTitleCase } from '@lfx-one/shared/utils';
import { AppService } from '@services/app.service';
import { ChangelogService } from '@services/changelog.service';
import { CreatePermissionService } from '@services/create-permission.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { SidebarNavService } from '@services/sidebar-nav.service';
import { UserService } from '@services/user.service';
import { LogoutLinkDirective } from '@shared/directives/logout-link.directive';
import { NavTooltipDirective } from '@shared/directives/nav-tooltip.directive';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Popover, PopoverModule } from 'primeng/popover';

/**
 * The redesigned LFX navbar (sidebar v2): the 48px lens rail and the 300px nav panel merged into one
 * floating 280px panel — brand row (LF apps menu, Create), lens tabs, context card, lens menu and a
 * footer with the account menu, impersonation, What's New and Documentation.
 *
 * Menu building, active-route highlighting, context switching and the SSR hydration gate are
 * inherited unchanged from {@link SidebarComponent}; this component only re-renders them in the
 * navbar markup and folds in the rail actions that used to live in the former lens-switcher rail.
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
  host: { class: 'lfxn-host' },
})
export class NavbarComponent extends SidebarComponent {
  private readonly navbarRouter = inject(Router);
  private readonly navbarLensService = inject(LensService);
  private readonly navbarPersonaService = inject(PersonaService);
  private readonly navbarUserService = inject(UserService);
  private readonly dialogService = inject(DialogService);
  private readonly changelogService = inject(ChangelogService);
  private readonly sidebarNavService = inject(SidebarNavService);
  private readonly appService = inject(AppService);
  protected readonly createPermissionService = inject(CreatePermissionService);

  /** Whether the host layout shifts the navbar down to clear the impersonation banner (main layout only). */
  public readonly bannerOffset = input<boolean>(false);

  protected readonly brandMenu = viewChild<Popover>('brandMenu');
  protected readonly createMenu = viewChild<Popover>('createMenu');
  protected readonly userMenu = viewChild<Popover>('userMenu');
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

  /**
   * The avatar URL that last failed to load. Google profile photos are served with
   * `referrerpolicy="no-referrer"` (they reject requests carrying the page as referrer); if one
   * still fails, the photo slots fall back to initials until the URL changes.
   */
  private readonly failedPhotoUrl = signal<string | null>(null);
  protected readonly photoUrl: Signal<string> = computed(() => {
    const url = this.avatarUrl();
    return url && url !== this.failedPhotoUrl() ? url : '';
  });

  // ── Lens tabs ────────────────────────────────────────────────────────────────────────────────
  protected readonly lensTabs: Signal<LensOption[]> = computed(() =>
    this.navbarLensService.displayLenses().map((lens) => ({ ...lens, ...NAVBAR_LENS_OVERRIDES[lens.id] }))
  );
  protected readonly activeLensId = this.navbarLensService.displayActiveLens;
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
    // An empty menu only means "no role" once everything that shapes it has resolved.
    if (this.sidebarNavService.sidebarItemsPending()) return null;
    return lens;
  });

  /** An empty project/foundation menu still waiting on what shapes it — keep the skeleton, not a blank panel. */
  protected readonly menuPending: Signal<boolean> = computed(
    () => this.navLens() !== null && this.itemsWithTestIds().length === 0 && this.sidebarNavService.sidebarItemsPending()
  );

  /** The empty menu comes from a failed lookup, not a confirmed denial: the card offers a retry instead. */
  protected readonly menuLookupFailed: Signal<boolean> = computed(() => this.sidebarNavService.menuLookupFailed());

  protected readonly noAccessGhostItems = NAVBAR_NO_ACCESS_GHOST_ITEMS;

  // ── Me card ──────────────────────────────────────────────────────────────────────────────────
  protected readonly roleMarks: Signal<NavbarRoleMark[]> = this.initRoleMarks();

  // ── Rail actions ─────────────────────────────────────────────────────────────────────────────
  protected readonly canImpersonate = this.navbarUserService.canImpersonate;
  protected readonly isImpersonating = this.navbarUserService.impersonating;
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

  public constructor() {
    super();
    // afterNextRender so input bindings have settled — the mobile drawer instance skips the fetch.
    afterNextRender(() => {
      if (!this.mobile()) {
        this.changelogService.loadUnseenCount();
      }
    });
    this.initTabIndicator();
  }

  /** Jump from a role chip to that project's or foundation's overview (the deep-link route the lens guards resolve). */
  protected openRoleProject(mark: NavbarRoleMark, chip: NavTooltipItem): void {
    const project = mark.projects.find((candidate) => candidate.slug === chip.key);
    if (!project?.lens) return;
    this.navbarRouter.navigate([`/${project.lens}`, 'overview'], { queryParams: { project: project.slug } });
  }

  protected onPhotoError(url: string): void {
    this.failedPhotoUrl.set(url);
  }

  protected switchLens(lens: Lens): void {
    this.navbarLensService.switchLens(lens);
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
    this.navbarLensService.setLens('me');
    this.navbarRouter.navigate(['/profile']);
  }

  protected navigateToProfileSettings(): void {
    this.userMenu()?.hide();
    this.navbarLensService.setLens('me');
    this.navbarRouter.navigate(['/profile/settings']);
  }

  protected openImpersonationDialog(): void {
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

  protected openChangelogDrawer(): void {
    this.changelogDrawerVisible.set(true);
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
    inject(DestroyRef).onDestroy(() => observer?.disconnect());
  }

  private initRoleMarks(): Signal<NavbarRoleMark[]> {
    return computed(() => {
      // Hidden for root-writers — executive-director is spoofed for them, not naturally detected.
      if (!this.showPersonaBadge()) return [];
      const personaProjects = this.navbarPersonaService.personaProjects();
      // Detection defaults every project to `isFoundation: false`; only a tier enrichment actually
      // resolved counts. Before enrichment, or for a project the metadata batch missed, the role's own
      // scope decides instead.
      const foundationByUid = new Map(
        this.navbarPersonaService
          .detectedProjects()
          .filter((project) => project.tierResolved)
          .map((project) => [project.projectUid, project.isFoundation])
      );
      const priority = new Map(PERSONA_PRIORITY.map((persona, index) => [persona, index]));
      const allowed = new Set(this.navbarLensService.availableLenses().map((option) => option.id));
      return [...this.navbarPersonaService.allPersonas()]
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
