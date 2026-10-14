// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { PendingActionItem } from '@lfx-one/shared/interfaces';

/**
 * Read-only summary of a group join request for the Me dashboard: who is asking, which group and
 * project it is for, what the group is, and the applicant's own message. All values come from the
 * applicant or group records, so they are rendered as text only — never as HTML.
 */
@Component({
  selector: 'lfx-join-request-summary',
  imports: [DatePipe],
  templateUrl: './join-request-summary.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoinRequestSummaryComponent {
  public readonly item = input.required<PendingActionItem>();
  /** Prefix for data-testid attributes so each host keeps its own test namespace. */
  public readonly testIdPrefix = input.required<string>();
}
