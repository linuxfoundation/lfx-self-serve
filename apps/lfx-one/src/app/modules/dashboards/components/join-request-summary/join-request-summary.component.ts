// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { getEntityCommands } from '@lfx-one/shared/utils';

import type { PendingActionItem } from '@lfx-one/shared/interfaces';

/**
 * Read-only summary of a group join request for the Me dashboard: who is asking, which group and project it is
 * for (the group links to its detail page), and the applicant's own message. All values come from the applicant
 * or group records, so they are rendered as text only — never as HTML.
 */
@Component({
  selector: 'lfx-join-request-summary',
  imports: [DatePipe, RouterLink],
  templateUrl: './join-request-summary.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinRequestSummaryComponent {
  public readonly item = input.required<PendingActionItem>();
  /** Prefix for data-testid attributes so each host keeps its own test namespace. */
  public readonly testIdPrefix = input.required<string>();
  /** Emitted when the group link is followed, so a host overlay (the drawer) can close itself. */
  public readonly groupLinkClick = output<void>();

  /** Canonical tier-prefixed group route; the flat `/groups/:uid` fallback covers an unknown tier, like invitation rows. */
  protected readonly groupCommands = computed<string[] | null>(() => {
    const { committeeUid, applicationIsFoundation } = this.item();
    if (!committeeUid) return null;
    return getEntityCommands('groups', committeeUid, applicationIsFoundation) ?? ['/groups', committeeUid];
  });
  protected readonly groupQueryParams = computed<{ project: string } | null>(() => {
    const slug = this.item().applicationProjectSlug;
    return slug ? { project: slug } : null;
  });
}
