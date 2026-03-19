// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, NgClass } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, CommitteeMemberVisibility, getCommitteeCategorySeverity, TagSeverity } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, combineLatest, finalize, of, switchMap } from 'rxjs';

import { CommitteeOverviewComponent } from '../components/committee-overview/committee-overview.component';

type CommitteeTab = 'overview' | 'members' | 'votes' | 'meetings' | 'surveys' | 'documents';

@Component({
  selector: 'lfx-committee-view',
  imports: [
    BreadcrumbComponent,
    ButtonComponent,
    TagComponent,
    ConfirmDialogModule,
    RouterLink,
    RouteLoadingComponent,
    DatePipe,
    NgClass,
    CommitteeOverviewComponent,
  ],
  templateUrl: './committee-view.component.html',
  styleUrl: './committee-view.component.scss',
})
export class CommitteeViewComponent {
  // -- Injections --
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);

  // -- Tab state --
  public activeTab = signal<CommitteeTab>('overview');

  // -- Writable signals --
  public loading = signal<boolean>(true);
  public error = signal<boolean>(false);
  public errorType = signal<'not-found' | 'server-error' | null>(null);
  public refresh = signal(0);

  // -- Computed / toSignal --
  public committee: Signal<Committee | null> = this.initializeCommittee();

  public categorySeverity: Signal<TagSeverity> = computed(() => {
    const category = this.committee()?.category;
    return getCommitteeCategorySeverity(category || '');
  });

  public breadcrumbItems: Signal<MenuItem[]> = computed(() => [{ label: 'Groups', routerLink: ['/groups'] }, { label: this.committee()?.name || '' }]);

  public canEdit: Signal<boolean> = computed(() => !!this.committee()?.writer);

  // -- Tab visibility signals --
  public isMembersTabVisible: Signal<boolean> = computed(() => this.committee()?.member_visibility !== CommitteeMemberVisibility.HIDDEN || this.canEdit());
  public isVotesTabVisible: Signal<boolean> = computed(() => !!this.committee()?.enable_voting);

  // -- Public methods --
  public goBack(): void {
    this.router.navigate(['/', 'groups']);
  }

  public refreshCommittee(): void {
    this.loading.set(true);
    this.refresh.update((v) => v + 1);
  }

  // -- Private initializer functions --
  private initializeCommittee(): Signal<Committee | null> {
    return toSignal(
      combineLatest([this.route.paramMap, toObservable(this.refresh)]).pipe(
        switchMap(([params]) => {
          const committeeId = params?.get('id');
          if (!committeeId) {
            this.errorType.set('not-found');
            this.error.set(true);
            this.loading.set(false);
            return of(null);
          }

          this.error.set(false);
          this.errorType.set(null);
          this.loading.set(true);

          return this.committeeService.getCommittee(committeeId).pipe(
            catchError((err) => {
              const status = err?.status;
              if (status === 404 || status === 403) {
                this.errorType.set('not-found');
              } else {
                this.errorType.set('server-error');
              }
              this.error.set(true);
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: status === 404 ? 'Group not found' : 'Failed to load group details',
              });
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
