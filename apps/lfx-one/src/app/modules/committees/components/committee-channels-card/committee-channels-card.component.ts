// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { getChatPlatformIcon, getChatPlatformLabel, getRepoPlatformIcon, getRepoPlatformLabel } from '@lfx-one/shared/utils';
import { SafeUrlPipe } from '@pipes/safe-url.pipe';

import { MailingListEmailPipe } from '../committee-settings-tab/pipes/mailing-list-email.pipe';

/**
 * Shared Channels card content (mailing lists, chat channel, website) used by both the
 * committee-view header and the About tab. Purely presentational — committee and mailing-list
 * data are passed down by the caller (both of which already fetch it) rather than fetched here.
 * `testIdPrefix` lets each call site keep its own existing data-testid namespace. Does not render
 * its own outer card chrome or heading — the caller supplies that, since the two call sites use
 * different wrappers.
 */
@Component({
  selector: 'lfx-committee-channels-card',
  imports: [ButtonComponent, TagComponent, MailingListEmailPipe, SafeUrlPipe],
  templateUrl: './committee-channels-card.component.html',
  styleUrl: './committee-channels-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick()' },
})
export class CommitteeChannelsCardComponent {
  public readonly committee = input.required<Committee>();
  public readonly associatedMailingLists = input<GroupsIOMailingList[]>([]);
  public readonly isVisitor = input<boolean>(false);
  public readonly testIdPrefix = input<string>('committee-channels-card');

  public mlExpanded = signal(false);

  public chatPlatformLabel: Signal<string> = computed(() => getChatPlatformLabel(this.committee()?.chat_channel));
  public chatPlatformIcon: Signal<string> = computed(() => getChatPlatformIcon(this.committee()?.chat_channel));
  public repoPlatformLabel: Signal<string> = computed(() => getRepoPlatformLabel(this.committee()?.website));
  public repoPlatformIcon: Signal<string> = computed(() => getRepoPlatformIcon(this.committee()?.website));

  public extraMailingLists: Signal<GroupsIOMailingList[]> = computed(() => this.associatedMailingLists().slice(1));
  public extraMailingListCount: Signal<number> = computed(() => this.associatedMailingLists().length - 1);

  public onDocumentClick(): void {
    if (this.mlExpanded()) {
      this.mlExpanded.set(false);
    }
  }
}
