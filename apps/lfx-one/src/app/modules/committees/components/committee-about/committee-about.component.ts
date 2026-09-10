// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, Signal } from '@angular/core';
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
import { TooltipModule } from 'primeng/tooltip';

import { CommitteeChannelsCardComponent } from '../committee-channels-card/committee-channels-card.component';
import { GroupJoinCtaComponent } from '../group-join-cta/group-join-cta.component';
import { openIcalSubscribeDialog } from '../../utils/ical-subscribe.util';

/**
 * Group "About" tab — visitor-safe summary (description, channels, meeting cadence, parent
 * project/group, key information, join CTA). Committee data, channels, parent-group/sub-groups,
 * and upcoming meetings are all passed down from committee-view (which already fetches/owns each
 * of them for the header) rather than re-fetched here. Description editing and all parent/group
 * navigation are requested via outputs and handled by committee-view, the existing owner of those
 * flows for the header — the only action this component performs itself is opening the iCal
 * subscribe dialog, which isn't duplicated elsewhere in this component (committee-meetings owns
 * its own copy of that dialog-open call via the same shared helper).
 */
@Component({
  selector: 'lfx-committee-about',
  imports: [
    CardComponent,
    ButtonComponent,
    TagComponent,
    SkeletonModule,
    PopoverModule,
    TooltipModule,
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

  // Inputs
  public readonly committee = input.required<Committee>();
  public readonly canEdit = input<boolean>(false);
  public readonly isVisitor = input<boolean>(false);
  public readonly hasPendingInvite = input<boolean>(false);
  public readonly hasPendingApplication = input<boolean>(false);
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
  public readonly editCharterRequested = output<void>();
  public readonly parentProjectNavigationRequested = output<void>();
  public readonly parentGroupNavigationRequested = output<void>();
  public readonly subGroupNavigationRequested = output<Committee>();

  // Complex computed
  public cadenceSummary: Signal<string> = computed(() => buildCommitteeCadenceSummary(this.upcomingMeetings()));
  // Single source for the "Removed by … on …" charter attribution, shared by the tooltip and the
  // aria-label so a future copy tweak can't desynchronize the sighted and screen-reader text.
  public charterRemovedLabel: Signal<string> = computed(() => {
    const charter = this.committee().charter;
    const who = charter?.updated_by?.name || charter?.updated_by?.username || 'someone';
    const when = charter?.updated_at ? formatDate(charter.updated_at, 'MMM d, y', 'en-US') : '';
    return `Removed by ${who} on ${when}`;
  });

  // Public methods
  public onSubscribe(): void {
    const committee = this.committee();
    if (!committee?.uid) {
      return;
    }
    openIcalSubscribeDialog(this.dialogService, committee);
  }
}
