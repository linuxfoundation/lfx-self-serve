// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, model, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { BadgeComponent } from '@components/badge/badge.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { environment } from '@environments/environment';
import { PERSONA_OPTIONS } from '@lfx-one/shared/constants';
import { EnrichedPersonaProject, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { toProjectContext } from '@lfx-one/shared/utils';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { filter } from 'rxjs';

@Component({
  selector: 'lfx-sidebar',
  imports: [NgClass, NgTemplateOutlet, RouterModule, AvatarComponent, BadgeComponent, ProjectSelectorComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);
  private readonly userService = inject(UserService);

  // Input properties
  public readonly items = input.required<SidebarMenuItem[]>();
  public readonly footerItems = input<SidebarMenuItem[]>([]);
  public readonly collapsed = input<boolean>(false);
  public readonly styleClass = input<string>('');
  public readonly showProjectSelector = input<boolean>(false);
  public readonly showMeSelector = input<boolean>(false);
  public readonly mobile = input<boolean>(false);
  public readonly selectorPanelOpen = model<boolean>(false);

  protected readonly activeLens = this.lensService.activeLens;
  protected readonly projects = computed(() => this.personaService.detectedProjects());
  protected readonly selectorProjects = computed(() => {
    const available = this.projectContextService.availableProjects();
    const allProjects = this.projects();
    const availableUids = new Set(available.map((p) => p.uid));
    return allProjects.filter((p) => availableUids.has(p.projectUid));
  });
  protected readonly selectedProject: Signal<EnrichedPersonaProject | null> = this.initSelectedProject();

  // Me selector signals
  protected readonly user = this.userService.user;
  protected readonly userInitials = this.userService.userInitials;
  protected readonly personaLabel: Signal<string> = this.initPersonaLabel();

  // Computed items with test IDs, external flag
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

  public constructor() {
    toObservable(this.projects)
      .pipe(
        filter((projects) => projects.length > 0),
        takeUntilDestroyed()
      )
      .subscribe((detectedProjects) => {
        this.projectContextService.ensureDefaultSelection(detectedProjects);
      });
  }

  protected onProjectChange(project: EnrichedPersonaProject): void {
    const context = toProjectContext(project);
    const lens = this.lensService.activeLens();

    if (lens === 'foundation') {
      this.projectContextService.setFoundation(context);
    } else {
      this.projectContextService.setProject(context);
    }
  }

  private initSelectedProject(): Signal<EnrichedPersonaProject | null> {
    return computed(() => {
      const ctx = this.projectContextService.activeContext();
      if (!ctx) {
        return null;
      }
      return this.projects().find((p) => p.projectUid === ctx.uid) || null;
    });
  }

  private initPersonaLabel(): Signal<string> {
    return computed(() => {
      const persona = this.personaService.currentPersona();
      const option = PERSONA_OPTIONS.find((o) => o.value === persona);
      return option?.label ?? persona;
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
