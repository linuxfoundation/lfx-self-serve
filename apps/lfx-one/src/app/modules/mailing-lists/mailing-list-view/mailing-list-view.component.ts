// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BreadcrumbComponent } from '@components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  COMMITTEE_LABEL,
  MAILING_LIST_AUDIENCE_ACCESS_LABELS,
  MAILING_LIST_LABEL,
  MAILING_LIST_MEMBER_LABEL,
  MAILING_LIST_TYPE_LABELS,
  MAILING_LIST_VISIBILITY_LABELS,
} from '@lfx-one/shared/constants';
import { MailingListAudienceAccess } from '@lfx-one/shared/enums';
import { CommitteeReference, GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { MailingListVisibilitySeverityPipe } from '@pipes/mailing-list-visibility-severity.pipe';
import { StripHtmlPipe } from '@pipes/strip-html.pipe';
import { MailingListService } from '@services/mailing-list.service';
import { MenuItem, MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, combineLatest, of, switchMap } from 'rxjs';

import { MailingListMembersComponent } from '../components/mailing-list-members/mailing-list-members.component';

@Component({
  selector: 'lfx-mailing-list-view',
  imports: [
    BreadcrumbComponent,
    CardComponent,
    ButtonComponent,
    TagComponent,
    LowerCasePipe,
    RouterLink,
    MailingListVisibilitySeverityPipe,
    StripHtmlPipe,
    MailingListMembersComponent,
    TooltipModule,
  ],
  templateUrl: './mailing-list-view.component.html',
  styleUrl: './mailing-list-view.component.scss',
})
export class MailingListViewComponent {
  // Private injections
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly mailingListService = inject(MailingListService);
  private readonly messageService = inject(MessageService);

  // Protected constants
  protected readonly mailingListLabel = MAILING_LIST_LABEL;
  protected readonly memberLabel = MAILING_LIST_MEMBER_LABEL;
  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly typeLabels = MAILING_LIST_TYPE_LABELS;
  protected readonly audienceAccessLabels = MAILING_LIST_AUDIENCE_ACCESS_LABELS;
  protected readonly visibilityLabels = MAILING_LIST_VISIBILITY_LABELS;

  // Simple WritableSignals
  public loading = signal<boolean>(true);
  public error = signal<boolean>(false);
  public refresh = new BehaviorSubject<void>(undefined);

  // Complex computed/toSignal signals
  public readonly mailingList: Signal<GroupsIOMailingList | null> = this.initMailingList();
  public readonly breadcrumbItems: Signal<MenuItem[]> = this.initBreadcrumbItems();
  public readonly emailAddress: Signal<string> = this.initEmailAddress();
  public readonly memberCount: Signal<number> = this.initMemberCount();
  public readonly linkedCommittees: Signal<CommitteeReference[]> = this.initLinkedCommittees();
  public readonly postingTypeLabel: Signal<string> = this.initPostingTypeLabel();
  public readonly audienceAccessLabel: Signal<string> = this.initAudienceAccessLabel();
  public readonly visibilityLabel: Signal<string> = this.initVisibilityLabel();
  public readonly groupsIoUrl: Signal<string | null> = this.initGroupsIoUrl();
  public readonly editRoute: Signal<string[]> = this.initEditRoute();

  public refreshData(): void {
    this.refresh.next();
  }

  // Private initializer functions
  private initMailingList(): Signal<GroupsIOMailingList | null> {
    return toSignal(
      combineLatest([this.route.paramMap, this.refresh]).pipe(
        switchMap(([params]) => {
          const mailingListId = params?.get('id');
          if (!mailingListId) {
            this.loading.set(false);
            this.error.set(true);
            return of(null);
          }

          return this.mailingListService.getMailingList(mailingListId).pipe(
            catchError(() => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load mailing list',
              });
              this.router.navigate(['/', 'mailing-lists']);
              return of(null);
            }),
            switchMap((mailingList) => {
              this.loading.set(false);
              return of(mailingList);
            })
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initBreadcrumbItems(): Signal<MenuItem[]> {
    return computed(() => [{ label: this.mailingListLabel.plural, routerLink: ['/mailing-lists'] }, { label: this.mailingList()?.title || '' }]);
  }

  private initEmailAddress(): Signal<string> {
    return computed(() => {
      const ml = this.mailingList();
      if (!ml?.group_name) return '';
      if (!ml.service?.domain) return ml.group_name;
      return `${ml.group_name}@${ml.service.domain}`;
    });
  }

  private initMemberCount(): Signal<number> {
    return computed(() => {
      // Placeholder - will be populated from API when available
      return 0;
    });
  }

  private initLinkedCommittees(): Signal<CommitteeReference[]> {
    return computed(() => this.mailingList()?.committees || []);
  }

  private initPostingTypeLabel(): Signal<string> {
    return computed(() => {
      const type = this.mailingList()?.type;
      if (!type) return '-';
      return this.typeLabels[type] || type;
    });
  }

  private initAudienceAccessLabel(): Signal<string> {
    return computed(() => {
      const access = this.mailingList()?.audience_access;
      if (!access) return '-';
      return this.audienceAccessLabels[access as MailingListAudienceAccess] || access;
    });
  }

  private initVisibilityLabel(): Signal<string> {
    return computed(() => {
      const isPublic = this.mailingList()?.public;
      if (isPublic === undefined || isPublic === null) return '-';
      return this.visibilityLabels[String(isPublic) as 'true' | 'false'];
    });
  }

  private initGroupsIoUrl(): Signal<string | null> {
    return computed(() => this.mailingList()?.service?.url || null);
  }

  private initEditRoute(): Signal<string[]> {
    return computed(() => {
      const uid = this.mailingList()?.uid;
      return uid ? ['/mailing-lists', uid, 'edit'] : ['/mailing-lists'];
    });
  }
}
