// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, GroupsIOMailingList, Meeting } from '@lfx-one/shared/interfaces';
import { buildCommitteeCadenceSummary } from '@lfx-one/shared/utils';
import { CategoryAvatarColorPipe } from '@pipes/category-avatar-color.pipe';
import { InitialsPipe } from '@pipes/initials.pipe';
import { JoinModeLabelPipe } from '@pipes/join-mode-label.pipe';
import { DialogService } from 'primeng/dynamicdialog';
import { PopoverModule } from 'primeng/popover';
import { SkeletonModule } from 'primeng/skeleton';

import { CommitteeChannelsCardComponent } from '../committee-channels-card/committee-channels-card.component';
import { GroupJoinCtaComponent } from '../group-join-cta/group-join-cta.component';
import { openIcalSubscribeDialog } from '../../utils/ical-subscribe.util';

/**
 * Group "About" tab — visitor-safe summary (description, channels, meeting cadence, parent
 * project/group, key information, join CTA). Purely presentational: committee data, channels,
 * parent-group/sub-groups, and upcoming meetings are all passed down from committee-view (which
 * already fetches/owns each of them for the header and description/parent-project actions) rather
 * than re-fetched or re-implemented here — description editing and parent-project navigation are
 * requested via outputs and handled by committee-view, the existing owner of both flows.
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
    CommitteeChannelsCardComponent,
    JoinModeLabelPipe,
    CategoryAvatarColorPipe,
    InitialsPipe,
    DatePipe,
  ],
  providers: [DialogService],
  templateUrl: './committee-about.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeAboutComponent {
  // Injections
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);

  // Inputs
  public readonly committee = input.required<Committee>();
  public readonly canEdit = input<boolean>(false);
  public readonly isVisitor = input<boolean>(false);
  public readonly hasPendingInvite = input<boolean>(false);
  // Passed down from committee-view, which already computes/fetches these for the header —
  // avoids a second, redundant round-trip for data the page has already loaded.
  public readonly associatedMailingLists = input<GroupsIOMailingList[]>([]);
  public readonly subGroups = input<Committee[]>([]);
  public readonly subGroupsLoading = input<boolean>(false);
  public readonly parentGroup = input<Committee | null>(null);
  public readonly hasChannels = input<boolean>(false);
  public readonly upcomingMeetings = input<Meeting[]>([]);
  public readonly meetingsLoading = input<boolean>(true);

  // Outputs
  public readonly joinRequested = output<void>();
  public readonly editDescriptionRequested = output<void>();
  public readonly parentProjectNavigationRequested = output<void>();

  // Complex computed
  public cadenceSummary: Signal<string> = computed(() => buildCommitteeCadenceSummary(this.upcomingMeetings()));

  // Public methods
  public onSubscribe(): void {
    const committee = this.committee();
    if (!committee?.uid) {
      return;
    }
    openIcalSubscribeDialog(this.dialogService, committee);
  }

  public navigateToParentGroup(): void {
    const parent = this.parentGroup();
    if (parent?.uid) {
      this.router.navigate(['/', 'groups', parent.uid]);
    }
  }

  public navigateToSubGroup(subGroup: Committee): void {
    this.router.navigate(['/', 'groups', subGroup.uid]);
  }
}
