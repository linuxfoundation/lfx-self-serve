// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, output, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LensItem, NavLens, ProjectContext } from '@lfx-one/shared/interfaces';
import { NavigationService } from '@services/navigation.service';
import { UserService } from '@services/user.service';
import { OnRenderDirective } from '@shared/directives/on-render.directive';
import { AutoFocus } from 'primeng/autofocus';
import { InputTextModule } from 'primeng/inputtext';
import { Popover, PopoverModule } from 'primeng/popover';

@Component({
  selector: 'lfx-project-selector',
  imports: [ReactiveFormsModule, PopoverModule, InputTextModule, AutoFocus, OnRenderDirective],
  templateUrl: './project-selector.component.html',
  styleUrl: './project-selector.component.scss',
})
export class ProjectSelectorComponent {
  private readonly userService = inject(UserService);
  private readonly navigationService = inject(NavigationService);

  public readonly lens = input.required<NavLens>();
  public readonly selectedProject = input<ProjectContext | null>(null);
  public readonly searchPlaceholder = input<string>('Search...');
  public readonly emptyMessage = input<string>('No results found');

  public readonly itemSelected = output<LensItem>();
  public readonly isPanelOpen = model<boolean>(false);

  protected readonly searchControl = new FormControl<string>('', { nonNullable: true });

  // Offset the popover when the impersonation banner is visible.
  protected readonly panelStyleClass = computed(() =>
    this.userService.impersonating() ? 'project-selector-panel project-selector-panel--with-banner' : 'project-selector-panel'
  );

  protected readonly displayName: Signal<string> = this.initializeDisplayName();
  protected readonly displayLogo: Signal<string> = this.initializeDisplayLogo();
  protected readonly items: Signal<LensItem[]> = this.initializeItems();
  protected readonly loading: Signal<boolean> = this.initializeLoading();
  protected readonly hasMore: Signal<boolean> = this.initializeHasMore();
  protected readonly autoLoadTriggerIndex: Signal<number> = this.initializeAutoLoadTriggerIndex();

  public constructor() {
    // Service applies its own debounce — push raw emissions here.
    this.searchControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((term) => this.navigationService.setSearchTerm(this.lens(), term));
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
    // Skip emit so UI + service reset in sync via the explicit setSearchTerm below.
    this.searchControl.setValue('', { emitEvent: false });
    this.navigationService.setSearchTerm(this.lens(), '');
  }

  protected loadMore(): void {
    this.navigationService.loadNextPage(this.lens());
  }

  private initializeDisplayName(): Signal<string> {
    return computed(() => {
      const project = this.selectedProject();
      return project?.name?.trim() || 'Select Project';
    });
  }

  private initializeDisplayLogo(): Signal<string> {
    return computed(() => {
      const project = this.selectedProject();
      return project?.logoUrl || '';
    });
  }

  private initializeItems(): Signal<LensItem[]> {
    return computed(() => this.navigationService.items(this.lens())());
  }

  private initializeLoading(): Signal<boolean> {
    return computed(() => this.navigationService.loading(this.lens())());
  }

  private initializeHasMore(): Signal<boolean> {
    return computed(() => this.navigationService.hasMore(this.lens())());
  }

  // Sentinel at items.length - 8; signal-based index shifts on each page so Angular re-creates
  // OnRenderDirective and re-fires the fetch.
  private initializeAutoLoadTriggerIndex(): Signal<number> {
    return computed(() => Math.max(0, this.items().length - 8));
  }
}
