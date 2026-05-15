// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, model, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BOARD_SCOPED_PERSONA_PRIORITY, PROJECT_SCOPED_PERSONA_PRIORITY } from '@lfx-one/shared/constants';
import { DisplayLensItem, LensItem, NavLens, PersonaType, ProjectContext, SelectorTab } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { UserService } from '@services/user.service';
import { OnRenderDirective } from '@shared/directives/on-render.directive';
import { AutoFocus } from 'primeng/autofocus';
import { InputTextModule } from 'primeng/inputtext';
import { Popover, PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-project-selector',
  imports: [NgClass, ReactiveFormsModule, PopoverModule, InputTextModule, AutoFocus, OnRenderDirective, TooltipModule],
  templateUrl: './project-selector.component.html',
  styleUrl: './project-selector.component.scss',
})
export class ProjectSelectorComponent {
  private readonly userService = inject(UserService);
  private readonly navigationService = inject(NavigationService);
  private readonly lensService = inject(LensService);
  private readonly personaService = inject(PersonaService);

  public readonly lens = input.required<NavLens>();
  public readonly selectedProject = input<ProjectContext | null>(null);
  public readonly searchPlaceholder = input<string>('Search...');
  public readonly emptyMessage = input<string>('No results found');
  public readonly hybridMode = input<boolean>(false);

  public readonly itemSelected = output<LensItem>();
  public readonly isPanelOpen = model<boolean>(false);

  protected readonly activeTab = signal<SelectorTab>('all');
  protected readonly selectorTabs: readonly SelectorTab[] = ['all', 'foundations', 'projects'];
  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });

  protected readonly panelStyleClass: Signal<string> = this.initPanelStyleClass();
  protected readonly lensTypeLabel: Signal<string> = this.initLensTypeLabel();
  protected readonly displayName: Signal<string> = this.initDisplayName();
  protected readonly displayLogo: Signal<string> = computed(() => this.selectedProject()?.logoUrl || '');
  protected readonly selectedRolePersona: Signal<PersonaType | null> = this.initSelectedRolePersona();
  protected readonly selectedRoleLabel: Signal<string> = computed(() => {
    const persona = this.selectedRolePersona();
    return persona ? this.personaTypeToLabel(persona) : '';
  });
  protected readonly selectedRoleIcon: Signal<string> = computed(() => {
    const persona = this.selectedRolePersona();
    return persona ? this.personaTypeToIcon(persona) : '';
  });

  protected readonly foundationItems: Signal<LensItem[]> = this.initFoundationItems();
  protected readonly rawProjectItems: Signal<LensItem[]> = this.initRawProjectItems();
  protected readonly loading: Signal<boolean> = this.initLoading();
  protected readonly hasMore: Signal<boolean> = this.initHasMore();
  protected readonly displayedItems: Signal<DisplayLensItem[]> = this.initDisplayedItems();

  protected readonly autoLoadTriggerIndex: Signal<number> = computed(() => Math.max(0, this.displayedItems().length - 8));

  public constructor() {
    this.searchControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((term) => {
      if (this.hybridMode()) {
        this.navigationService.setSearchTerm('foundation', term);
        this.navigationService.setSearchTerm('project', term);
      } else {
        this.navigationService.setSearchTerm(this.lens(), term);
      }
    });
  }

  protected selectItem(item: LensItem, popover: Popover): void {
    this.itemSelected.emit(item);
    popover.hide();
  }

  protected togglePanel(event: Event, popover: Popover): void {
    popover.toggle(event);
  }

  protected onPopoverShow(): void {
    this.isPanelOpen.set(true);
  }

  protected onPopoverHide(): void {
    this.isPanelOpen.set(false);
    this.activeTab.set('all');
    this.searchControl.setValue('', { emitEvent: false });
    if (this.hybridMode()) {
      this.navigationService.setSearchTerm('foundation', '');
      this.navigationService.setSearchTerm('project', '');
    } else {
      this.navigationService.setSearchTerm(this.lens(), '');
    }
  }

  protected loadMore(): void {
    if (this.hybridMode()) {
      const tab = this.activeTab();
      // All-tab drains foundations first so the higher-priority group completes before standalone projects appear.
      if (tab === 'foundations') {
        this.navigationService.loadNextPage('foundation');
        return;
      }
      if (tab === 'projects') {
        this.navigationService.loadNextPage('project');
        return;
      }
      if (this.navigationService.hasMore('foundation')()) {
        this.navigationService.loadNextPage('foundation');
      } else {
        this.navigationService.loadNextPage('project');
      }
    } else {
      this.navigationService.loadNextPage(this.lens());
    }
  }

  private initPanelStyleClass(): Signal<string> {
    return computed(() => (this.userService.impersonating() ? 'project-selector-panel project-selector-panel--with-banner' : 'project-selector-panel'));
  }

  private initLensTypeLabel(): Signal<string> {
    return computed(() => {
      if (this.hybridMode()) {
        const selectedUid = this.selectedProject()?.uid;
        if (selectedUid) {
          const detected = this.personaService.detectedProjects().find((p) => p.projectUid === selectedUid);
          if (detected) {
            return detected.isFoundation ? 'Foundation' : 'Project';
          }
        }
        return this.lensService.activeLens() === 'foundation' ? 'Foundation' : 'Project';
      }
      return this.lens() === 'foundation' ? 'Foundation' : 'Project';
    });
  }

  private initDisplayName(): Signal<string> {
    return computed(() => {
      const project = this.selectedProject();
      return project?.name?.trim() || `Select ${this.lensTypeLabel()}`;
    });
  }

  private initSelectedRolePersona(): Signal<PersonaType | null> {
    return computed(() => {
      const uid = this.selectedProject()?.uid;
      if (!uid) return null;
      const detected = this.personaService.detectedProjects().find((p) => p.projectUid === uid);
      const isFoundation = detected?.isFoundation ?? this.lensService.activeLens() === 'foundation';
      const priority = isFoundation ? BOARD_SCOPED_PERSONA_PRIORITY : PROJECT_SCOPED_PERSONA_PRIORITY;
      const personaProjects = this.personaService.personaProjects();
      for (const persona of priority) {
        if ((personaProjects[persona] ?? []).some((p) => p.projectUid === uid)) {
          return persona;
        }
      }
      return this.fallbackRolePersona(priority);
    });
  }

  private initFoundationItems(): Signal<LensItem[]> {
    return computed(() => (this.hybridMode() ? this.navigationService.items('foundation')() : []));
  }

  private initRawProjectItems(): Signal<LensItem[]> {
    // NavigationService.applyVisibilityFilters already filters foundations from the project lens when the foundation lens is available; re-filtering here would hide rows project-only users are meant to select.
    return computed(() => this.navigationService.items(this.hybridMode() ? 'project' : this.lens())());
  }

  private initLoading(): Signal<boolean> {
    return computed(() => {
      if (this.hybridMode()) {
        return this.navigationService.loading('foundation')() || this.navigationService.loading('project')();
      }
      return this.navigationService.loading(this.lens())();
    });
  }

  private initHasMore(): Signal<boolean> {
    return computed(() => {
      if (this.hybridMode()) {
        const tab = this.activeTab();
        if (tab === 'foundations') return this.navigationService.hasMore('foundation')();
        if (tab === 'projects') return this.navigationService.hasMore('project')();
        return this.navigationService.hasMore('foundation')() || this.navigationService.hasMore('project')();
      }
      return this.navigationService.hasMore(this.lens())();
    });
  }

  private initDisplayedItems(): Signal<DisplayLensItem[]> {
    return computed(() => {
      const selectedUid = this.selectedProject()?.uid ?? null;
      if (!this.hybridMode()) {
        return this.sortByRole(this.rawProjectItems()).map((item) => this.toDisplayItem(item, false, selectedUid));
      }
      const tab = this.activeTab();
      if (tab === 'foundations') {
        return this.sortByRole(this.foundationItems()).map((item) => this.toDisplayItem(item, false, selectedUid));
      }
      if (tab === 'projects') {
        return this.sortByRole(this.rawProjectItems()).map((item) => this.toDisplayItem(item, false, selectedUid));
      }
      return this.buildAllTabItems(selectedUid);
    });
  }

  private toDisplayItem(item: LensItem, isNested: boolean, selectedUid: string | null): DisplayLensItem {
    const persona = this.resolveRolePersona(item);
    return {
      item,
      isNested,
      isSelected: selectedUid === item.uid,
      roleLabel: persona ? this.personaTypeToLabel(persona) : '',
      roleIcon: persona ? this.personaTypeToIcon(persona) : '',
    };
  }

  private resolveRolePersona(item: LensItem): PersonaType | null {
    const priority = item.isFoundation ? BOARD_SCOPED_PERSONA_PRIORITY : PROJECT_SCOPED_PERSONA_PRIORITY;
    const personaProjects = this.personaService.personaProjects();
    for (const persona of priority) {
      if ((personaProjects[persona] ?? []).some((p) => p.projectUid === item.uid)) {
        return persona;
      }
    }
    return this.fallbackRolePersona(priority);
  }

  // personaProjects only covers projects with explicit detections, but the navigation API returns
  // every accessible project. For non-hybrid users the scope is unambiguous (board-only or
  // project-only), so we surface the highest-priority persona they hold within that scope.
  private fallbackRolePersona(priority: readonly PersonaType[]): PersonaType | null {
    if (this.hybridMode()) {
      return null;
    }
    const allPersonas = this.personaService.allPersonas();
    for (const persona of priority) {
      if (allPersonas.includes(persona)) {
        return persona;
      }
    }
    return null;
  }

  private personaTypeToLabel(persona: PersonaType): string {
    const map: Record<PersonaType, string> = {
      'executive-director': 'Executive Director',
      'board-member': 'Board Member',
      maintainer: 'Maintainer',
      contributor: 'Contributor',
    };
    return map[persona] ?? '';
  }

  private personaTypeToIcon(persona: PersonaType): string {
    const map: Record<PersonaType, string> = {
      'executive-director': 'fa-light fa-briefcase',
      'board-member': 'fa-light fa-building-columns',
      maintainer: 'fa-light fa-code',
      contributor: 'fa-light fa-code',
    };
    return map[persona] ?? '';
  }

  private roleIndex(item: LensItem): number {
    const priority = item.isFoundation ? BOARD_SCOPED_PERSONA_PRIORITY : PROJECT_SCOPED_PERSONA_PRIORITY;
    const personaProjects = this.personaService.personaProjects();
    for (let i = 0; i < priority.length; i++) {
      if ((personaProjects[priority[i]] ?? []).some((p) => p.projectUid === item.uid)) {
        return i;
      }
    }
    return priority.length;
  }

  private sortByRole(items: LensItem[]): LensItem[] {
    return [...items].sort((a, b) => {
      const diff = this.roleIndex(a) - this.roleIndex(b);
      return diff !== 0 ? diff : (a.name ?? '').localeCompare(b.name ?? '');
    });
  }

  private buildAllTabItems(selectedUid: string | null): DisplayLensItem[] {
    const sortedFoundations = this.sortByRole(this.foundationItems());
    const sortedProjects = this.sortByRole(this.rawProjectItems());

    // Pre-group projects by parent foundation in a single pass so nesting is O(F + P), not O(F × P).
    const detectedProjects = this.personaService.detectedProjects();
    const parentByProjectUid = new Map<string, string>();
    for (const dp of detectedProjects) {
      if (dp.parentProjectUid) {
        parentByProjectUid.set(dp.projectUid, dp.parentProjectUid);
      }
    }

    const foundationUidSet = new Set(sortedFoundations.map((f) => f.uid));
    const childrenByFoundationUid = new Map<string, LensItem[]>();
    const nestedProjectUids = new Set<string>();
    for (const project of sortedProjects) {
      const parentUid = parentByProjectUid.get(project.uid);
      if (parentUid && foundationUidSet.has(parentUid)) {
        const bucket = childrenByFoundationUid.get(parentUid);
        if (bucket) {
          bucket.push(project);
        } else {
          childrenByFoundationUid.set(parentUid, [project]);
        }
        nestedProjectUids.add(project.uid);
      }
    }

    const result: DisplayLensItem[] = [];
    for (const foundation of sortedFoundations) {
      result.push(this.toDisplayItem(foundation, false, selectedUid));
      const children = childrenByFoundationUid.get(foundation.uid);
      if (children) {
        for (const project of children) {
          result.push(this.toDisplayItem(project, true, selectedUid));
        }
      }
    }

    for (const project of sortedProjects) {
      if (!nestedProjectUids.has(project.uid)) {
        result.push(this.toDisplayItem(project, false, selectedUid));
      }
    }

    return result;
  }
}
