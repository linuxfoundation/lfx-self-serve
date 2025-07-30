// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { FilterButton, Project } from '@lfx-pcc/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { MenuItem } from 'primeng/api';
import { ChipModule } from 'primeng/chip';
import { of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-project-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, BreadcrumbComponent, ChipModule],
  templateUrl: './project-layout.component.html',
  styleUrl: './project-layout.component.scss',
})
export class ProjectLayoutComponent {
  // Input signals
  public readonly activatedRoute = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);

  // Load project data based on slug from URL
  public project: Signal<Project | null> = toSignal(
    this.activatedRoute.params.pipe(
      switchMap((params) => {
        const slug = params['slug'];
        if (slug) {
          return this.projectService.getProject(slug);
        }

        return of(null);
      })
    ),
    { initialValue: null }
  );

  public readonly projectTitle = computed(() => this.project()?.name || '');
  public readonly projectDescription = computed(() => this.project()?.description || '');
  public readonly categoryLabel = computed(() => this.project()?.slug || '');
  public readonly projectSlug = computed(() => this.project()?.slug || '');
  public readonly projectLogo = computed(() => this.project()?.logo || '');
  public readonly breadcrumbItems = input<MenuItem[]>([
    {
      label: 'All Projects',
      routerLink: '/',
      icon: 'fa-light fa-chevron-left',
      routerLinkActiveOptions: { exact: false },
    },
  ]);

  // Internal state signals
  private readonly activeFilterSignal = signal<string>('All projects');

  // Filter buttons with computed active state
  public readonly menuItems: Signal<MenuItem[]> = computed(() => [
    { label: 'Dashboard', icon: 'fa-light fa-house text-blue-500', routerLink: `/project/${this.projectSlug()}`, routerLinkActiveOptions: { exact: true } },
    {
      label: 'Meetings',
      icon: 'fa-light fa-calendar-days text-blue-500',
      routerLink: `/project/${this.projectSlug()}/meetings`,
      routerLinkActiveOptions: { exact: false },
    },
    {
      label: 'Committees',
      icon: 'fa-light fa-people-group text-green-500',
      routerLink: `/project/${this.projectSlug()}/committees`,
      routerLinkActiveOptions: { exact: false },
    },
    {
      label: 'Mailing Lists',
      icon: 'fa-light fa-envelope text-amber-500',
      routerLink: `/project/${this.projectSlug()}/mailing-lists`,
      routerLinkActiveOptions: { exact: false },
    },
  ]);

  public readonly metrics = computed(() => [
    { icon: 'fa-light fa-calendar-days text-blue-500', label: 'Meetings', value: this.project()?.meetings_count || 0 },
    { icon: 'fa-light fa-people-group text-green-500', label: 'Committees', value: this.project()?.committees_count || 0 },
    { icon: 'fa-light fa-envelope text-amber-500', label: 'Mailing Lists', value: this.project()?.mailing_list_count || 0 },
  ]);

  protected onFilterClick(filter: FilterButton): void {
    this.activeFilterSignal.set(filter.label);
    // TODO: Emit filter change event
  }

  protected onFiltersClick(): void {
    // TODO: Implement filters modal/dropdown
  }
}
