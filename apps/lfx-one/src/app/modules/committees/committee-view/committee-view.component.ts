// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, CommitteeMember, COMMITTEE_CATEGORY_SEVERITY } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, combineLatest, of, switchMap, throwError } from 'rxjs';

import { CommitteeMembersComponent } from '../components/committee-members/committee-members.component';
import { UpcomingCommitteeMeetingComponent } from '../components/upcoming-committee-meeting/upcoming-committee-meeting.component';

@Component({
  selector: 'lfx-committee-view',
  imports: [
    CommonModule,
    CardComponent,
    MenuComponent,
    ButtonComponent,
    TagComponent,
    CommitteeMembersComponent,
    UpcomingCommitteeMeetingComponent,
    ConfirmDialogModule,
    DynamicDialogModule,
  ],
  providers: [DialogService],
  templateUrl: './committee-view.component.html',
  styleUrl: './committee-view.component.scss',
})
export class CommitteeViewComponent {
  // Injected services
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly committeeService = inject(CommitteeService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);

  // Class variables with types
  private dialogRef: DynamicDialogRef | undefined;
  public committee: Signal<Committee | null>;
  public members: WritableSignal<CommitteeMember[]>;
  public membersLoading: WritableSignal<boolean>;
  public loading: WritableSignal<boolean>;
  public error: WritableSignal<boolean>;
  public isDeleting: WritableSignal<boolean>;
  public actionMenuItems: MenuItem[];
  public formattedCreatedDate: Signal<string>;
  public formattedUpdatedDate: Signal<string>;
  public refresh: BehaviorSubject<void>;
  public categorySeverity: Signal<'info' | 'success' | 'warn' | 'danger' | 'secondary' | 'contrast'>;

  public constructor() {
    // Initialize all class variables
    this.error = signal<boolean>(false);
    this.isDeleting = signal<boolean>(false);
    this.refresh = new BehaviorSubject<void>(undefined);
    this.members = signal<CommitteeMember[]>([]);
    this.membersLoading = signal<boolean>(true);
    this.loading = signal<boolean>(true);
    this.committee = this.initializeCommittee();
    this.actionMenuItems = this.initializeActionMenuItems();
    this.formattedCreatedDate = this.initializeFormattedCreatedDate();
    this.formattedUpdatedDate = this.initializeFormattedUpdatedDate();
    this.categorySeverity = computed(() => {
      const category = this.committee()?.category;
      return category ? COMMITTEE_CATEGORY_SEVERITY[category] || 'secondary' : 'secondary';
    });
  }

  public goBack(): void {
    this.router.navigate(['/', 'groups']);
  }

  public toggleActionMenu(event: Event, menuComponent: MenuComponent): void {
    event.stopPropagation();
    menuComponent.toggle(event);
  }

  public refreshMembers(): void {
    this.refresh.next();
  }

  // Action handlers
  private editCommittee(): void {
    this.openEditDialog();
  }

  private deleteCommittee(): void {
    const committee = this.committee();
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

    this.committeeService.deleteCommittee(committee.uid).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.goBack();
      },
      error: (error) => {
        this.isDeleting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to delete committee',
        });
        console.error('Failed to delete committee:', error);
      },
    });
  }

  private openEditDialog(): void {
    const committee = this.committee();
    if (committee) {
      this.router.navigate(['/groups', committee.uid, 'edit']);
    }
  }

  private initializeCommittee(): Signal<Committee | null> {
    return toSignal(
      combineLatest([this.route.paramMap, this.refresh]).pipe(
        switchMap(([params]) => {
          const committeeId = params?.get('id');
          if (!committeeId) {
            this.error.set(true);
            return of(null);
          }

          const committeeQuery = this.committeeService.getCommittee(committeeId).pipe(
            catchError(() => {
              console.error('Failed to load committee');
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load committee',
              });
              this.router.navigate(['/', 'groups']);
              return throwError(() => new Error('Failed to load committee'));
            })
          );

          const membersQuery = this.committeeService.getCommitteeMembers(committeeId).pipe(
            catchError(() => {
              console.error('Failed to load committee members');
              return of([]);
            })
          );

          return combineLatest([committeeQuery, membersQuery]).pipe(
            switchMap(([committee, members]) => {
              this.members.set(members);
              this.loading.set(false);
              this.membersLoading.set(false);
              return of(committee);
            })
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initializeActionMenuItems(): MenuItem[] {
    return [
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

  private initializeFormattedCreatedDate(): Signal<string> {
    return computed(() => {
      const committee = this.committee();
      if (!committee?.created_at) return '-';
      const date = new Date(committee.created_at);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    });
  }

  private initializeFormattedUpdatedDate(): Signal<string> {
    return computed(() => {
      const committee = this.committee();
      if (!committee?.updated_at) return '-';
      const date = new Date(committee.updated_at);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    });
  }
}
