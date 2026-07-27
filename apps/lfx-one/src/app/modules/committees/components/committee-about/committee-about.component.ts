// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import { Committee, GroupsIOMailingList, Meeting, ProjectContext } from '@lfx-one/shared/interfaces';
import { buildCommitteeCadenceSummary, getChatPlatformIcon, getChatPlatformLabel, getRepoPlatformIcon, getRepoPlatformLabel } from '@lfx-one/shared/utils';
import { CategoryAvatarColorPipe } from '@pipes/category-avatar-color.pipe';
import { InitialsPipe } from '@pipes/initials.pipe';
import { JoinModeLabelPipe } from '@pipes/join-mode-label.pipe';
import { SafeUrlPipe } from '@pipes/safe-url.pipe';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { PopoverModule } from 'primeng/popover';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, finalize, of, switchMap, take } from 'rxjs';

import { DescriptionDialogComponent } from '../description-dialog/description-dialog.component';
import { GroupJoinCtaComponent } from '../group-join-cta/group-join-cta.component';
import { IcalSubscribeDialogComponent } from '../ical-subscribe-dialog/ical-subscribe-dialog.component';
import { MailingListEmailPipe } from '../committee-settings-tab/pipes/mailing-list-email.pipe';

/**
 * Group "About" tab — visitor-safe summary (description, channels, meeting cadence, parent
 * project/group, key information, join CTA). Reuses the same signals/services as the always-visible
 * committee-view header and the Overview tab rather than re-deriving them.
 */
@Component({
  selector: 'lfx-committee-about',
  imports: [
    CardComponent,
    ButtonComponent,
    TagComponent,
    SkeletonModule,
    PopoverModule,
    NgClass,
    GroupJoinCtaComponent,
    SafeUrlPipe,
    MailingListEmailPipe,
    JoinModeLabelPipe,
    CategoryAvatarColorPipe,
    InitialsPipe,
    DatePipe,
  ],
  providers: [DialogService],
  templateUrl: './committee-about.component.html',
  host: { '(document:click)': 'onDocumentClick()' },
})
export class CommitteeAboutComponent {
  // Injections
  private readonly committeeService = inject(CommitteeService);
  private readonly mailingListService = inject(MailingListService);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly lensService = inject(LensService);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);
  public isVisitor = input<boolean>(false);
  public hasPendingInvite = input<boolean>(false);

  // Outputs
  public readonly joinRequested = output<void>();
  public readonly committeeUpdated = output<void>();

  // Simple WritableSignals
  public mlExpanded = signal(false);
  public subGroupsLoading = signal(true);
  public meetingsLoading = signal(true);

  // Complex computed/toSignal — via private init functions
  public chatPlatformLabel: Signal<string> = this.initChatPlatformLabel();
  public chatPlatformIcon: Signal<string> = this.initChatPlatformIcon();
  public repoPlatformLabel: Signal<string> = this.initRepoPlatformLabel();
  public repoPlatformIcon: Signal<string> = this.initRepoPlatformIcon();

  public associatedMailingLists: Signal<GroupsIOMailingList[]> = this.initAssociatedMailingLists();
  public extraMailingLists: Signal<GroupsIOMailingList[]> = computed(() => this.associatedMailingLists().slice(1));
  public extraMailingListCount: Signal<number> = computed(() => this.associatedMailingLists().length - 1);

  public subGroups: Signal<Committee[]> = this.initSubGroups();
  public parentGroup: Signal<Committee | null> = this.initParentGroup();

  public hasChannels: Signal<boolean> = computed(() => {
    const c = this.committee();
    return this.associatedMailingLists().length > 0 || !!(c?.chat_channel || c?.website) || this.canEdit();
  });

  public upcomingMeetings: Signal<Meeting[]> = this.initUpcomingMeetings();
  public cadenceSummary: Signal<string> = computed(() => buildCommitteeCadenceSummary(this.upcomingMeetings()));

  // Public methods
  public openDescriptionView(): void {
    this.dialogService.open(DescriptionDialogComponent, {
      header: 'Description',
      width: '560px',
      modal: true,
      closable: true,
      draggable: false,
      data: { mode: 'view', description: this.committee()?.description || '' },
    });
  }

  public openEditDescription(): void {
    const ref = this.dialogService.open(DescriptionDialogComponent, {
      header: 'Edit Description',
      width: '560px',
      modal: true,
      closable: true,
      draggable: false,
      data: { mode: 'edit', description: this.committee()?.description || '' },
    });
    ref?.onClose.pipe(take(1)).subscribe((newDescription: string | undefined) => {
      if (newDescription !== undefined) {
        this.saveDescription(newDescription);
      }
    });
  }

  public saveDescription(description: string): void {
    const committee = this.committee();
    if (!committee) {
      return;
    }
    this.committeeService.updateCommittee(committee.uid, { description }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Description updated' });
        this.committeeUpdated.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: getHttpErrorDetail(err, 'Failed to update description. Please try again.') });
      },
    });
  }

  public onSubscribe(): void {
    const committee = this.committee();
    if (!committee?.uid) {
      return;
    }
    const feedUrl = `${environment.urls.home}/public/api/committees/${committee.uid}/calendar.ics`;
    const committeeName = committee.name ?? 'Committee';
    this.dialogService.open(IcalSubscribeDialogComponent, {
      header: `Subscribe — ${committeeName}`,
      width: '480px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { feedUrl, name: committeeName },
    });
  }

  public navigateToParentGroup(): void {
    const parent = this.parentGroup();
    if (parent?.uid) {
      this.router.navigate(['/', 'groups', parent.uid]);
    }
  }

  public navigateToParentProject(): void {
    const c = this.committee();
    if (!c?.project_uid || !c.project_slug) return;
    const context: ProjectContext = {
      uid: c.project_uid,
      name: c.project_name || c.foundation_name || c.project_slug,
      slug: c.project_slug,
    };
    if (c.is_foundation) {
      this.projectContextService.setFoundation(context);
      this.lensService.setLens('foundation');
      this.router.navigate(['/foundation/overview']);
    } else {
      this.projectContextService.setProject(context);
      this.lensService.setLens('project');
      this.router.navigate(['/project/overview']);
    }
  }

  public navigateToSubGroup(subGroup: Committee): void {
    this.router.navigate(['/', 'groups', subGroup.uid]);
  }

  public onDocumentClick(): void {
    if (this.mlExpanded()) {
      this.mlExpanded.set(false);
    }
  }

  // Private initializer functions
  private initChatPlatformLabel(): Signal<string> {
    return computed(() => getChatPlatformLabel(this.committee()?.chat_channel));
  }

  private initChatPlatformIcon(): Signal<string> {
    return computed(() => getChatPlatformIcon(this.committee()?.chat_channel));
  }

  private initRepoPlatformLabel(): Signal<string> {
    return computed(() => getRepoPlatformLabel(this.committee()?.website));
  }

  private initRepoPlatformIcon(): Signal<string> {
    return computed(() => getRepoPlatformIcon(this.committee()?.website));
  }

  private initAssociatedMailingLists(): Signal<GroupsIOMailingList[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c): c is Committee => !!c?.uid),
        switchMap((c) => this.mailingListService.getMailingListsByCommittee(c.uid).pipe(catchError(() => of([]))))
      ),
      { initialValue: [] }
    );
  }

  private initSubGroups(): Signal<Committee[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c): c is Committee => !!c?.uid),
        switchMap((c) => {
          this.subGroupsLoading.set(true);
          return this.committeeService.getChildCommittees(c.uid).pipe(
            catchError(() => of([])),
            finalize(() => this.subGroupsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initParentGroup(): Signal<Committee | null> {
    return toSignal(
      toObservable(this.committee).pipe(
        switchMap((c) => {
          if (!c?.parent_uid) {
            return of(null);
          }
          return this.committeeService.fetchCommittee(c.parent_uid).pipe(catchError(() => of(null)));
        })
      ),
      { initialValue: null }
    );
  }

  private initUpcomingMeetings(): Signal<Meeting[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c): c is Committee => !!c?.uid),
        switchMap((c) => {
          this.meetingsLoading.set(true);
          return this.meetingService.getUpcomingMeetingsByCommittee(c.uid).pipe(
            catchError(() => of([])),
            finalize(() => this.meetingsLoading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
