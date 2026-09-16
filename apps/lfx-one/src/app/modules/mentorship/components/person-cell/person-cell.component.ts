// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';

/**
 * The leading person cell shared by the program-detail people tables — avatar, the
 * person's name, and an optional reviewer-note line beneath it. Extracted because the
 * truncation chain it relies on (`min-w-0` on the flex child, a width that leaves room
 * for the avatar) is easy to get subtly wrong in one table and not the others.
 *
 * Omit `noteLabel` for a read-only table, such as Past Mentees.
 */
@Component({
  selector: 'lfx-mentorship-person-cell',
  imports: [AvatarComponent],
  templateUrl: './person-cell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonCellComponent {
  public readonly name = input.required<string>();
  public readonly initials = input.required<string>();
  public readonly avatarStyleClass = input.required<string>();
  public readonly avatarUrl = input<string | undefined>(undefined);
  /** Test id for the note button; required whenever `noteLabel` is set. */
  public readonly noteTestId = input<string | undefined>(undefined);
  /** The note preview, or the "Add note" prompt. Absent means the row shows no note line. */
  public readonly noteLabel = input<string | undefined>(undefined);
  public readonly hasNote = input(false);
  public readonly noteClick = output<void>();
}
