// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BadgeComponent } from '@components/badge/badge.component';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { COMMITTEE_LABEL, GROUPS_CARD_GRID_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MyCommittee, MyGroupsCardVm } from '@lfx-one/shared/interfaces';
import { formatRelativeTime, getGroupCommands, resolveGroupsCardRoleSeverity } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-my-groups-card-grid',
  imports: [BadgeComponent, ButtonComponent, EmptyStateComponent, RouterLink, TooltipModule],
  templateUrl: './my-groups-card-grid.component.html',
})
export class MyGroupsCardGridComponent {
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

  /**
   * `ariaLabel` folds every piece of metadata the card visually shows (behavioral-class label,
   * project/foundation name, role, member count, last-updated, privacy) into the link's accessible
   * name. `[attr.aria-label]` on the card `<a>` replaces its computed accessible name outright, so
   * none of that visible content is otherwise reachable by assistive tech — this is the single
   * source of truth for what gets announced, not the DOM content underneath it. Keep this in sync
   * with the template whenever a new field is added to the card.
   */
  private initCards(): Signal<MyGroupsCardVm[]> {
    return computed(() =>
      this.committees().map((committee) => {
        const memberCount = committee.total_members;
        const lastActivityLabel = formatRelativeTime(new Date(committee.updated_at));
        const scopeLabel = committee.project_name || committee.foundation_name;
        const parts = [
          `Open ${committee.name || 'group'}`,
          ...(committee.classDisplay ? [committee.classDisplay.label] : []),
          ...(scopeLabel ? [scopeLabel] : []),
          committee.my_role || 'Member',
          `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`,
          `updated ${lastActivityLabel}`,
        ];
        if (!committee.public) parts.push('private');
        return {
          committee,
          roleBadgeSeverity: resolveGroupsCardRoleSeverity(committee.my_role),
          lastActivityLabel,
          // Canonical tier-prefixed view link (GH-1566): the group's own `is_foundation` picks
          // /foundation vs /project; rows without tier data keep the flat /groups/:uid fallback.
          viewCommands: getGroupCommands(committee) ?? ['/groups', committee.uid],
          viewQueryParams: committee.project_slug ? { project: committee.project_slug } : null,
          ariaLabel: parts.join(', '),
        };
      })
    );
  }
}
