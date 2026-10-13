// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, output, PLATFORM_ID, signal, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { COMMITTEE_LABEL, GROUPS_CARD_GRID_PAGE_SIZE, JOIN_MODE_TOOLTIPS } from '@lfx-one/shared/constants';
import { MyCommittee, MyGroupsCardVm } from '@lfx-one/shared/interfaces';
import {
  formatRelativeTime,
  getCommitteeMailingListLink,
  getGroupCommands,
  resolveGroupsCardRoleSeverity,
  resolveJoinModeSeverity,
  resolveTypeDisplay,
} from '@lfx-one/shared/utils';
import { JoinModeLabelPipe } from '@app/shared/pipes/join-mode-label.pipe';
import { ValidExternalUrlPipe } from '@app/shared/pipes/valid-external-url.pipe';
import { MessageService } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-my-groups-card-grid',
  imports: [BadgeComponent, ButtonComponent, EmptyStateComponent, RouterLink, TagComponent, JoinModeLabelPipe, ValidExternalUrlPipe, TooltipModule],
  templateUrl: './my-groups-card-grid.component.html',
})
export class MyGroupsCardGridComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly messageService = inject(MessageService);

  // Inputs
  public readonly committees = input.required<MyCommittee[]>();
  public readonly hasItems = input<boolean>(true);

  // Outputs
  public readonly resetRequested = output<void>();

  protected readonly committeeLabel = COMMITTEE_LABEL;

  /**
   * How many pages of `GROUPS_CARD_GRID_PAGE_SIZE` the caller has revealed via "Show more".
   * Deliberately not reset when `committees()` narrows (e.g. a search) — `visibleCards` naturally
   * caps at the shorter list via `slice`, and widening the list back out (clearing the search)
   * restores the same page count rather than collapsing back to one page, which would be a jarring
   * UX for no correctness benefit.
   */
  private readonly expandedPages = signal(1);

  protected readonly cards: Signal<MyGroupsCardVm[]> = this.initCards();
  protected readonly visibleCards = computed(() => this.cards().slice(0, this.expandedPages() * GROUPS_CARD_GRID_PAGE_SIZE));
  protected readonly hasMore = computed(() => this.visibleCards().length < this.cards().length);
  protected showMore(): void {
    this.expandedPages.update((pages) => pages + 1);
  }

  protected async copyPublicGroupLink(committee: MyCommittee): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !navigator.clipboard?.writeText) {
      this.messageService.add({ severity: 'error', summary: 'Copy not supported', detail: 'Clipboard access is unavailable in this browser.' });
      return;
    }
    const groupPath = committee.sso_group_name || committee.uid;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/groups/${groupPath}`);
      this.messageService.add({ severity: 'success', summary: 'Link copied', detail: 'Public group link copied to clipboard.' });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Copy failed', detail: 'Could not access clipboard.' });
    }
  }

  private initCards(): Signal<MyGroupsCardVm[]> {
    return computed(() =>
      this.committees().map((committee) => {
        const lastActivityLabel = formatRelativeTime(new Date(committee.updated_at));
        const typeDisplay = resolveTypeDisplay(committee);
        const effectiveJoinMode = committee.join_mode ?? 'invite_only';
        const mailingListLink = getCommitteeMailingListLink(committee);
        return {
          committee,
          roleBadgeSeverity: resolveGroupsCardRoleSeverity(committee.my_role),
          lastActivityLabel,
          // Canonical tier-prefixed view link (GH-1566): the group's own `is_foundation` picks
          // /foundation vs /project; rows without tier data keep the flat /groups/:uid fallback.
          viewCommands: getGroupCommands(committee) ?? ['/groups', committee.uid],
          viewQueryParams: committee.project_slug ? { project: committee.project_slug } : null,
          mailingListLink,
          mailingListAriaLabel: mailingListLink ? this.getMailingListAriaLabel(committee.name, mailingListLink.label) : null,
          typeDisplay,
          joinModeSeverity: resolveJoinModeSeverity(effectiveJoinMode),
          joinModeTooltip: JOIN_MODE_TOOLTIPS[effectiveJoinMode],
        };
      })
    );
  }

  private getMailingListAriaLabel(groupName: string | undefined, listLabel: string | null): string {
    const base = `Mailing list for ${groupName || 'group'}`;
    return listLabel ? `${base}: ${listLabel}` : base;
  }
}
