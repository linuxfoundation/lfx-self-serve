// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, CommitteeMember, getCommitteeCategorySeverity, TagSeverity } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { BehaviorSubject, catchError, combineLatest, of, switchMap, throwError } from 'rxjs';

import { CommitteeMembersComponent } from '../components/committee-members/committee-members.component';

@Component({
  selector: 'lfx-committee-view',
  imports: [BreadcrumbComponent, CardComponent, ButtonComponent, TagComponent, CommitteeMembersComponent, ConfirmDialogModule],
  templateUrl: './committee-view.component.html',
  styleUrl: './committee-view.component.scss',
})
export class CommitteeViewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);

  public committee: Signal<Committee | null>;
  public members: WritableSignal<CommitteeMember[]>;
  public membersLoading: WritableSignal<boolean>;
  public loading: WritableSignal<boolean>;
  public error: WritableSignal<boolean>;
  public formattedCreatedDate: Signal<string>;
  public formattedUpdatedDate: Signal<string>;
  public refresh: BehaviorSubject<void>;
  public categorySeverity: Signal<TagSeverity>;
  public breadcrumbItems: Signal<MenuItem[]>;

  public constructor() {
    this.error = signal<boolean>(false);
    this.refresh = new BehaviorSubject<void>(undefined);
    this.members = signal<CommitteeMember[]>([]);
    this.membersLoading = signal<boolean>(true);
    this.loading = signal<boolean>(true);
    this.committee = this.initializeCommittee();
    this.formattedCreatedDate = this.initializeFormattedCreatedDate();
    this.formattedUpdatedDate = this.initializeFormattedUpdatedDate();
    this.categorySeverity = computed(() => {
      const category = this.committee()?.category;
      return getCommitteeCategorySeverity(category || '');
    });
    this.breadcrumbItems = computed(() => [{ label: 'Groups', routerLink: ['/groups'] }, { label: this.committee()?.name || '' }]);
  }

  public goBack(): void {
    this.router.navigate(['/', 'groups']);
  }

  public refreshMembers(): void {
    this.refresh.next();
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
