// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, output, type Signal } from '@angular/core';
import type { MeetingComposerProjectLabel, MeetingComposerRailRow, MeetingComposerScopeNote } from '@lfx-one/shared/interfaces';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { MeetingComposerService } from '../meeting-composer.service';
import { MeetingComposerScopeNoteComponent } from './meeting-composer-scope-note.component';

/** Left rail of the composer modal: project and title, then create steps or the edit section list, then the edit scope note. */
@Component({
  selector: 'lfx-meeting-composer-modal-rail',
  imports: [NgClass, UiAvatarComponent, MeetingComposerScopeNoteComponent],
  templateUrl: './meeting-composer-modal-rail.component.html',
  host: { class: 'hidden min-h-0 min-[973px]:flex' },
})
export class MeetingComposerModalRailComponent {
  private readonly composer = inject(MeetingComposerService);
  private readonly formService = inject(MeetingComposerFormService);

  public readonly heading = input.required<string>();
  public readonly project = input<MeetingComposerProjectLabel | null>(null);
  public readonly scope = input<MeetingComposerScopeNote | null>(null);

  public readonly editSeries = output<void>();

  protected readonly isEditMode: Signal<boolean> = this.formService.isEditMode;
  protected readonly loadFailed: Signal<boolean> = this.formService.meetingLoadFailed;
  protected readonly rows: Signal<MeetingComposerRailRow[]> = this.initRows();

  protected onSelect(row: MeetingComposerRailRow): void {
    if (row.active || !row.reachable) {
      return;
    }

    this.composer.setSection(row.section.id);
  }

  private initRows(): Signal<MeetingComposerRailRow[]> {
    return computed(() => {
      // FormGroup validity isn't reactive on its own; the revision signal makes it one.
      this.formService.revision();

      const sections = this.formService.visibleSections();
      const activeSection = this.composer.activeSection();
      const visited = this.composer.visitedSections();
      const isEditMode = this.isEditMode();
      // Create unlocks a section once every required section before it is valid.
      const limit = this.formService.sectionAdvanceLimit();

      return sections.map((section, index) => {
        const active = section.id === activeSection;
        const reachable = active || isEditMode || index <= limit;

        return {
          section,
          active,
          reachable,
          complete: !active && reachable && visited.has(section.id) && this.formService.isSectionValid(section.id),
          needsAttention: !active && this.formService.sectionNeedsAttention(section, visited),
          isLast: index === sections.length - 1,
        };
      });
    });
  }
}
