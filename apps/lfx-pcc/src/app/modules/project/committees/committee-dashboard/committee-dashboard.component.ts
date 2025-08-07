// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MenuComponent } from '@components/menu/menu.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { Committee } from '@lfx-pcc/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { BehaviorSubject, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, startWith, switchMap, tap } from 'rxjs/operators';

import { CommitteeFormComponent } from '../components/committee-form/committee-form.component';
import { UpcomingCommitteeMeetingComponent } from '../components/upcoming-committee-meeting/upcoming-committee-meeting.component';

@Component({
  selector: 'lfx-committee-dashboard',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    CardComponent,
    MenuComponent,
    TableComponent,
    InputTextComponent,
    SelectComponent,
    ButtonComponent,
    ConfirmDialogModule,
    DynamicDialogModule,
    AnimateOnScrollModule,
    UpcomingCommitteeMeetingComponent,
  ],
  providers: [DialogService],
  templateUrl: './committee-dashboard.component.html',
  styleUrl: './committee-dashboard.component.scss',
})
export class CommitteeDashboardComponent {
  // Injected services
  private readonly projectService = inject(ProjectService);
  private readonly committeeService = inject(CommitteeService);
  private readonly router = inject(Router);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);

  // Class variables with types
  public project: typeof this.projectService.project;
  public selectedCommittee: WritableSignal<Committee | null>;
  public isDeleting: WritableSignal<boolean>;
  public first: WritableSignal<number>;
  public rows: number;
  public searchForm: FormGroup;
  public categoryFilter: WritableSignal<string | null>;
  public committeesLoading: WritableSignal<boolean>;
  public committees: Signal<Committee[]>;
  public categories: Signal<{ label: string; value: string | null }[]>;
  public filteredCommittees: Signal<Committee[]>;
  public totalRecords: Signal<number>;
  public menuItems: MenuItem[];
  public actionMenuItems: MenuItem[];
  public refresh: BehaviorSubject<void>;
  private searchTerm: Signal<string>;
  private dialogRef: DynamicDialogRef | undefined;

  public constructor() {
    // Initialize all class variables
    this.project = this.projectService.project;
    this.selectedCommittee = signal<Committee | null>(null);
    this.isDeleting = signal<boolean>(false);
    this.first = signal<number>(0);
    this.rows = 10;
    this.committeesLoading = signal<boolean>(true);
    this.refresh = new BehaviorSubject<void>(undefined);
    this.committees = this.initializeCommittees();
    this.searchForm = this.initializeSearchForm();
    this.categoryFilter = signal<string | null>(null);
    this.searchTerm = this.initializeSearchTerm();
    this.categories = this.initializeCategories();
    this.filteredCommittees = this.initializeFilteredCommittees();
    this.totalRecords = this.initializeTotalRecords();
    this.menuItems = this.initializeMenuItems();
    this.actionMenuItems = this.initializeActionMenuItems();
  }

  public onPageChange(event: any): void {
    this.first.set(event.first);
  }

  public onCategoryChange(value: string | null): void {
    // Update the category filter signal
    this.categoryFilter.set(value);
    // Reset to first page when changing filter
    this.first.set(0);
  }

  public onSearch(): void {
    // Reset to first page when searching
    this.first.set(0);
  }

  public formatDate(dateString: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  // Toggle action menu for a committee
  public toggleActionMenu(event: Event, committee: Committee, menuComponent: MenuComponent): void {
    event.stopPropagation();
    this.selectedCommittee.set(committee);
    menuComponent.toggle(event);
  }

  // Dialog methods for create/edit
  public openCreateDialog(): void {
    const projectId = this.project()?.id;
    if (!projectId) return;

    this.dialogRef = this.dialogService.open(CommitteeFormComponent, {
      header: 'Create Committee',
      width: '600px',
      contentStyle: { overflow: 'auto' },
      modal: true,
      closable: true,
      data: {
        isEditing: false,
        projectId: projectId,
        onCancel: () => this.dialogRef?.close(),
      },
    });
  }

  // Action handlers (use selectedCommittee)
  private viewCommittee(): void {
    const committee = this.selectedCommittee();
    const projectId = this.project()?.id;
    if (committee && projectId) {
      this.router.navigate(['/project', this.project()?.slug, 'committees', committee.id]);
    }
  }

  private editCommittee(): void {
    this.openEditDialog();
  }

  private deleteCommittee(): void {
    const committee = this.selectedCommittee();
    if (!committee) return;

    this.confirmationService.confirm({
      message: `Are you sure you want to delete the committee "${committee.name}"? This action cannot be undone.`,
      header: 'Delete Committee',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.performDelete(committee),
    });
  }

  private performDelete(committee: Committee): void {
    this.isDeleting.set(true);

    this.committeeService.deleteCommittee(committee.id).subscribe({
      next: () => {
        this.isDeleting.set(false);
        // Refresh the committees list by reloading
        this.refreshCommittees();
      },
      error: (error) => {
        this.isDeleting.set(false);
        console.error('Failed to delete committee:', error);
        // TODO: Show error toast/notification
      },
    });
  }

  private refreshCommittees(): void {
    this.refresh.next();
  }

  private openEditDialog(): void {
    const committee = this.selectedCommittee();
    if (!committee) return;

    this.dialogRef = this.dialogService.open(CommitteeFormComponent, {
      header: 'Edit Committee',
      width: '600px',
      contentStyle: { overflow: 'auto' },
      modal: true,
      closable: true,
      data: {
        isEditing: true,
        committee: committee,
        committeeId: committee.id,
        onCancel: () => this.dialogRef?.close(),
      },
    });
  }

  // Private initialization methods
  private initializeSearchForm(): FormGroup {
    return new FormGroup({
      search: new FormControl<string>(''),
      category: new FormControl<string | null>(null),
    });
  }

  private initializeSearchTerm(): Signal<string> {
    return toSignal(this.searchForm.get('search')!.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), { initialValue: '' });
  }

  private initializeCommittees(): Signal<Committee[]> {
    return toSignal(
      this.project()
        ? this.refresh.pipe(
            tap(() => this.committeesLoading.set(true)),
            switchMap(() => this.committeeService.getCommitteesByProject(this.project()!.id).pipe(tap(() => this.committeesLoading.set(false))))
          )
        : of([]),
      { initialValue: [] }
    );
  }

  private initializeCategories(): Signal<{ label: string; value: string | null }[]> {
    return computed(() => {
      const committeesData = this.committees();
      const uniqueCategories = [...new Set(committeesData.map((c) => c.category).filter(Boolean))];
      return [{ label: 'All Categories', value: null }, ...uniqueCategories.map((cat) => ({ label: cat, value: cat }))];
    });
  }

  private initializeFilteredCommittees(): Signal<Committee[]> {
    return computed(() => {
      let filtered = this.committees();

      // Apply search filter
      const searchTerm = this.searchTerm()?.toLowerCase() || '';
      if (searchTerm) {
        filtered = filtered.filter(
          (committee) =>
            committee.name.toLowerCase().includes(searchTerm) ||
            committee.description?.toLowerCase().includes(searchTerm) ||
            committee.category?.toLowerCase().includes(searchTerm)
        );
      }

      // Apply category filter
      const category = this.categoryFilter();
      if (category) {
        filtered = filtered.filter((committee) => committee.category === category);
      }

      return filtered;
    });
  }

  private initializeTotalRecords(): Signal<number> {
    return computed(() => this.filteredCommittees().length);
  }

  private initializeMenuItems(): MenuItem[] {
    return [
      {
        label: 'Create Committee',
        icon: 'fa-light fa-users-medical text-sm',
        command: () => this.openCreateDialog(),
      },
    ];
  }

  private initializeActionMenuItems(): MenuItem[] {
    return [
      {
        label: 'View',
        icon: 'fa-light fa-eye',
        command: () => this.viewCommittee(),
      },
      {
        label: 'Edit',
        icon: 'fa-light fa-edit',
        command: () => this.editCommittee(),
      },
      {
        separator: true,
      },
      {
        label: 'Delete',
        icon: 'fa-light fa-trash',
        styleClass: 'text-red-500',
        disabled: this.isDeleting(),
        command: () => this.deleteCommittee(),
      },
    ];
  }
}
