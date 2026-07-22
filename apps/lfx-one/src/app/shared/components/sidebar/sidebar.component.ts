// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { afterNextRender, Component, computed, inject, input, model, Signal, signal, viewChild } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { BadgeComponent } from '@components/badge/badge.component';
import { LensTabsComponent } from '@components/lens-tabs/lens-tabs.component';
import { OrgSelectorComponent } from '@components/org-selector/org-selector.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { environment } from '@environments/environment';
import { ORG_LENS_ENABLED_FLAG, PERSONA_OPTIONS, PERSONA_PRIORITY, PROFILE_TABS } from '@lfx-one/shared/constants';
import { LensItem, NavLens, PersonaType, ProfileTab, ProjectContext, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { lensItemToProjectContext, toTitleCase } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { Popover, PopoverModule } from 'primeng/popover';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';

const PERSONA_ICONS: Partial<Record<PersonaType, string>> = {
  'executive-director': 'fa-light fa-briefcase',
  'board-member': 'fa-light fa-building-columns',
  maintainer: 'fa-light fa-code',
  contributor: 'fa-light fa-code',
};

@Component({
  selector: 'lfx-sidebar',
  imports: [
    NgClass,
    NgTemplateOutlet,
    RouterModule,
    AvatarComponent,
    BadgeComponent,
    LensTabsComponent,
    OrgSelectorComponent,
    ProjectSelectorComponent,
    PopoverModule,
    SkeletonModule,
    TooltipModule,
  ],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);
  private readonly navigationService = inject(NavigationService);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly featureFlagService = inject(FeatureFlagService);

  public readonly items = input.required<SidebarMenuItem[]>();
  public readonly footerItems = input<SidebarMenuItem[]>([]);
  public readonly collapsed = input<boolean>(false);
  public readonly styleClass = input<string>('');
  public readonly showProjectSelector = input<boolean>(false);
  /** Parent lens hint for the org-selector slot; ANDed with the flag + grants/seeds gate to produce `effectiveShowOrgSelector` (spec 020 D-005). */
  public readonly showOrgSelector = input<boolean>(false);
  public readonly showMeSelector = input<boolean>(false);
  public readonly mobile = input<boolean>(false);
  public readonly selectorPanelOpen = model<boolean>(false);

  /** Final org-selector visibility — `parent input ∧ flag ∧ (writers ∨ auditors ∨ personaSeeds)` per research.md D-005. */
  protected readonly effectiveShowOrgSelector: Signal<boolean> = this.initEffectiveShowOrgSelector();

  private readonly orgLensFlag: Signal<boolean> = this.featureFlagService.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false);

  protected readonly activeLens = this.lensService.activeLens;
  protected readonly isOrgLens = computed(() => this.activeLens() === 'org');
  protected readonly isHybridPersona = this.lensService.isHybridPersona;
  protected readonly selectedProject: Signal<ProjectContext | null> = computed(() => this.projectContextService.activeContext());
  protected readonly navLens: Signal<NavLens | null> = this.initNavLens();
  protected readonly lensLoaded: Signal<boolean> = this.initLensLoaded();

  // Browser-only hydration gate. The org lens is enabled by a browser-only LaunchDarkly flag, so the
  // server render always clamps to the me lens and would emit a me-lens menu; hydrating that against a
  // client-resolved org menu leaves stale me-lens nodes on screen. Holding the concrete menu back until
  // afterNextRender means the server and the first client render both show the loading skeleton
  // (skeleton→skeleton reconciles cleanly), then the real menu is inserted as a post-hydration update.
  protected readonly hydrated = signal(false);

  protected readonly user = this.userService.user;
  protected readonly userInitials = this.userService.userInitials;
  protected readonly personaLabels: Signal<{ label: string; icon: string; names: string[]; ariaLabel: string }[]> = this.initPersonaLabels();
  // Hide the persona badge when the user is a root-writer — executive-director is spoofed, not naturally detected.
  protected readonly showPersonaBadge: Signal<boolean> = computed(() => !this.personaService.isRootWriter());

  // Profile & Account tabs for the me-lens card overflow (⋯) dropdown → /profile/<route>
  protected readonly profileTabs: ProfileTab[] = PROFILE_TABS;
  protected readonly profileMenu = viewChild<Popover>('profileMenu');

  protected readonly itemsWithTestIds = computed(() =>
    this.items().map((item) => ({
      ...item,
      testId: item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
      external: item.url ? this.isExternalUrl(item.url) : undefined,
      items: item.items?.map((childItem) => ({
        ...childItem,
        testId: childItem.testId || `sidebar-item-${childItem.label.toLowerCase().replace(/\s+/g, '-')}`,
        external: childItem.url ? this.isExternalUrl(childItem.url) : undefined,
      })),
    }))
  );

  protected readonly footerItemsWithTestIds = computed(() =>
    this.footerItems().map((item) => ({
      ...item,
      testId: item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
      external: item.url ? this.isExternalUrl(item.url) : undefined,
    }))
  );

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
    // Group expansion is keyed by item.label — group labels must be unique within a single sidebar items tree.
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
    afterNextRender(() => this.hydrated.set(true));
  }

  protected toggleGroup(label: string): void {
    const items = this.items();
    const current = this.expandedGroupStates()[label] ?? true;
    const prev = this.expandedGroupOverrides();
    const baseOverrides = prev.itemsRef === items ? prev.overrides : {};
    this.expandedGroupOverrides.set({ itemsRef: items, overrides: { ...baseOverrides, [label]: !current } });
  }

  // Toggle the me-lens card overflow popover. stopPropagation keeps the click from
  // reaching document-level outside-click handlers, not the (sibling) stretched link.
  protected toggleProfileMenu(event: Event): void {
    event.stopPropagation();
    this.profileMenu()?.toggle(event);
  }

  protected closeProfileMenu(): void {
    this.profileMenu()?.hide();
  }

  protected onItemSelected(item: LensItem): void {
    const context = lensItemToProjectContext(item);
    // Project-only users still see foundations in their project list (NavigationService only filters
    // foundations out when the foundation lens is visible). Treat a foundation row as a project context
    // for those users — setLens('foundation') would be a no-op and the selection would silently fail.
    const foundationAllowed = this.lensService.availableLenses().some((option) => option.id === 'foundation');
    if (item.isFoundation && foundationAllowed) {
      this.projectContextService.setFoundation(context);
      this.lensService.setLens('foundation');
    } else {
      this.projectContextService.setProject(context);
      this.lensService.setLens('project');
    }
    this.redirectOnContextSwitch(context.slug);
  }

  // Keep the URL's lens prefix in sync with the selected context so a hard refresh restores it
  // (syncLensFromRoute + projectQueryParamGuard). Redirect on lens-type change or off an entity page.
  private redirectOnContextSwitch(projectSlug: string): void {
    const segments = this.router.url.split('?')[0].split('/').filter(Boolean);
    const currentPrefix = segments[0];
    if (currentPrefix !== 'project' && currentPrefix !== 'foundation') {
      return;
    }
    // activeLens() reflects setLens() synchronously; pass the slug explicitly since router.url lags
    // location.replaceState, so queryParamsHandling:'preserve' would carry stale params.
    const targetLens = this.activeLens() === 'foundation' ? 'foundation' : 'project';
    const lensTypeChanged = currentPrefix !== targetLens;
    const onEntityPage = segments.length === 3;
    if (lensTypeChanged || onEntityPage) {
      this.router.navigate([`/${targetLens}`, 'overview'], { queryParams: { project: projectSlug } });
    }
  }

  private initEffectiveShowOrgSelector(): Signal<boolean> {
    return computed<boolean>(() => {
      if (!this.showOrgSelector()) return false;
      if (!this.orgLensFlag()) return false;
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

  private initPersonaLabels(): Signal<{ label: string; icon: string; names: string[]; ariaLabel: string }[]> {
    return computed(() => {
      const personaProjects = this.personaService.personaProjects();
      const toTag = (p: PersonaType) => {
        const option = PERSONA_OPTIONS.find((o) => o.value === p);
        const label = option?.label ?? toTitleCase(p);
        const icon = PERSONA_ICONS[p] ?? 'fa-light fa-user';
        const names = (personaProjects[p] ?? []).map((proj) => proj.projectName).filter((n): n is string => !!n);
        const ariaLabel = names.length ? `Role: ${label} (${names.join(', ')})` : `Role: ${label}`;
        return { label, icon, names, ariaLabel };
      };

      if (this.activeLens() === 'me') {
        const priorityMap = new Map(PERSONA_PRIORITY.map((p, i) => [p, i]));
        const sorted = [...this.personaService.allPersonas()].sort(
          (a, b) => (priorityMap.get(a) ?? Number.MAX_SAFE_INTEGER) - (priorityMap.get(b) ?? Number.MAX_SAFE_INTEGER)
        );
        return sorted.slice(0, 3).map(toTag);
      }

      return [toTag(this.personaService.currentPersona())];
    });
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
