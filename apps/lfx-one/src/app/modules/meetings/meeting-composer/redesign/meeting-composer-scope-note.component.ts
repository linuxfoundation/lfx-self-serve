// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import type { MeetingComposerScopeNote } from '@lfx-one/shared/interfaces';
import { UiNoteComponent } from '@shared/uikit/note/note.component';

/** States what an edit changes: a one-time meeting, one occurrence, or the whole series. */
@Component({
  selector: 'lfx-meeting-composer-scope-note',
  imports: [UiNoteComponent],
  templateUrl: './meeting-composer-scope-note.component.html',
})
export class MeetingComposerScopeNoteComponent {
  public readonly scope = input.required<MeetingComposerScopeNote>();

  public readonly editSeries = output<void>();
}
