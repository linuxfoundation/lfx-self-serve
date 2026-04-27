// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, model, Signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { BadgeComponent } from '@components/badge/badge.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { environment } from '@environments/environment';
import { PERSONA_OPTIONS, PERSONA_PRIORITY } from '@lfx-one/shared/constants';
import { LensItem, NavLens, PersonaType, ProjectContext, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { lensItemToProjectContext, toTitleCase } from '@lfx-one/shared/utils';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';

const PERSONA_ICONS: Partial<Record<PersonaType, string>> = {
  'executive-director': 'fa-light fa-briefcase',
  'board-member': 'fa-light fa-building-columns',
  'maintainer': 'fa-light fa-code',
  'contributor': 'fa-light fa-code',
};

@Component({
  selector: 'lfx-sidebar',
  imports: [NgClass, NgTemplateOutlet, RouterModule, AvatarComponent, BadgeComponent, ProjectSelectorComponent, SkeletonModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);
  private readonly navigationService = inject(NavigationService);
  private readonly userService = inject(UserService);

  public readonly items = input.required<SidebarMenuItem[]>();
  public readonly footerItems = input<SidebarMenuItem[]>([]);
  public readonly collapsed = input<boolean>(false);
  public readonly styleClass = input<string>('');
  public readonly showProjectSelector = input<boolean>(false);
  public readonly showMeSelector = input<boolean>(false);
  public readonly mobile = input<boolean>(false);
  public readonly selectorPanelOpen = model<boolean>(false);

  protected readonly activeLens = this.lensService.activeLens;
  protected readonly isOrgLens = computed(() => this.activeLens() === 'org');
  protected readonly selectedProject: Signal<ProjectContext | null> = computed(() => this.projectContextService.activeContext());
  protected readonly navLens: Signal<NavLens | null> = this.initNavLens();
  protected readonly lensLoaded: Signal<boolean> = this.initLensLoaded();

  protected readonly user = this.userService.user;
  protected readonly userInitials = this.userService.userInitials;
  protected readonly personaLabels: Signal<{ label: string; icon: string }[]> = this.initPersonaLabels();
  // Hide the persona badge when the user is a root-writer — executive-director is spoofed, not naturally detected.
  protected readonly showPersonaBadge: Signal<boolean> = computed(() => !this.personaService.isRootWriter());

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

  protected onItemSelected(item: LensItem): void {
    const context = lensItemToProjectContext(item);
    const lens = this.lensService.activeLens();

    if (lens === 'foundation') {
      this.projectContextService.setFoundation(context);
    } else if (lens === 'project') {
      this.projectContextService.setProject(context);
    }
  }

  private initNavLens(): Signal<NavLens | null> {
    return computed(() => {
      const lens = this.activeLens();
      return lens === 'foundation' || lens === 'project' ? lens : null;
    });
  }

  private initLensLoaded(): Signal<boolean> {
    return computed(() => {
      if (this.isOrgLens()) return false;
      const lens = this.navLens();
      if (!lens) return true;
      return this.navigationService.loaded(lens)();
    });
  }

  private initPersonaLabels(): Signal<{ label: string; icon: string }[]> {
    return computed(() => {
      const toTag = (p: PersonaType) => {
        const option = PERSONA_OPTIONS.find((o) => o.value === p);
        return { label: option?.label ?? toTitleCase(p), icon: PERSONA_ICONS[p] ?? 'fa-light fa-user' };
      };

      if (this.activeLens() === 'me') {
        const priorityMap = new Map(PERSONA_PRIORITY.map((p, i) => [p, i]));
        const sorted = [...this.personaService.allPersonas()].sort(
          (a, b) => (priorityMap.get(a) ?? Number.MAX_SAFE_INTEGER) - (priorityMap.get(b) ?? Number.MAX_SAFE_INTEGER),
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
