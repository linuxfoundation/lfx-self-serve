// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { GROUPS_HOME_LINK_STATE } from '@lfx-one/shared/constants';
import { GroupChannel, MyCommittee } from '@lfx-one/shared/interfaces';
import { getGroupChannels, isModifiedClick } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';

/** A group's mailing list and chat channel as small icon buttons, each only when the group has it. */
@Component({
  selector: 'lfx-group-channels',
  imports: [UiButtonComponent],
  templateUrl: './group-channels.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class GroupChannelsComponent {
  private readonly router = inject(Router);

  public readonly group = input.required<MyCommittee>();

  protected readonly channels: Signal<GroupChannel[]> = computed(() => getGroupChannels(this.group()));

  /** An in-app mailing list opens in the app on a plain click, with the Groups back label for a group page. */
  protected onChannelClick(event: MouseEvent, channel: GroupChannel): void {
    const link = channel.link;
    if (!link || isModifiedClick(event)) return;
    event.preventDefault();
    void this.router.navigate(link.commands, { queryParams: link.queryParams, state: link.target === 'group' ? GROUPS_HOME_LINK_STATE : undefined });
  }
}
