// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { afterRenderEffect, Component, computed, ElementRef, inject, input, type Signal } from '@angular/core';
import { MEETING_COMPOSER_SECTIONS } from '@lfx-one/shared/constants';
import type { MeetingComposerRailRow, MeetingComposerSection, MeetingComposerSectionId } from '@lfx-one/shared/interfaces';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * Section navigation for the meeting composer (LFXV2-3240).
 * @description Create mode is a progress stepper: later sections stay locked until every earlier
 * required section is valid, so the organizer can't skip past a section that would block submit.
 * Edit mode is a flat menu — the meeting already exists, so every section is reachable. `compact`
 * renders either mode as a horizontal chip row, which is what the composer shows below `lg` where the
 * rail column is hidden (LFXV2-3243).
 */
@Component({
  selector: 'lfx-meeting-composer-rail',
  imports: [NgClass],
  templateUrl: './meeting-composer-rail.component.html',
})
export class MeetingComposerRailComponent {
  protected readonly composer = inject(MeetingComposerService);
  private readonly formService = inject(MeetingComposerFormService);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Renders as a horizontal chip row instead of a vertical stepper.
   * @description What the composer shows below `lg`, where the rail column is hidden: the same rows and
   * the same locking, laid out to fit above the section content.
   */
  public readonly compact = input(false);

  private readonly sections: readonly MeetingComposerSection[] = MEETING_COMPOSER_SECTIONS;

  protected readonly rows: Signal<MeetingComposerRailRow[]> = this.initRows();
  // Both layouts can be in the DOM at once, so their test ids have to differ.
  protected readonly testIdPrefix: Signal<string> = computed(() => (this.compact() ? 'meeting-composer-rail-compact' : 'meeting-composer-rail'));
  // Edit mode has no ordering and no Next/Back, so announcing a step would describe a wizard that
  // isn't there — matching what the desktop edit rows already do.
  protected readonly activeChipAriaCurrent: Signal<'step' | 'true'> = computed(() => (this.composer.isEditMode() ? 'true' : 'step'));

  public constructor() {
    // The chip row is wider than a phone, so a section reached from the footer would otherwise
    // highlight a chip scrolled off-screen. `afterRenderEffect` so the chip carrying the marker is the
    // freshly active one, and because it never runs during SSR.
    afterRenderEffect({
      earlyRead: () => {
        this.composer.activeSection();

        return this.compact() ? this.elementRef.nativeElement.querySelector<HTMLElement>('[data-active-chip]') : null;
      },
      // `scrollIntoView` reads layout before it scrolls, so it is a mixed read/write rather than the pure
      // write the `write` phase promises.
      mixedReadWrite: (chip) => chip()?.scrollIntoView({ block: 'nearest', inline: 'center' }),
    });
  }

  protected onSelect(row: MeetingComposerRailRow): void {
    if (row.locked || row.active) {
      return;
    }

    this.composer.setSection(row.section.id);
  }

  private initRows(): Signal<MeetingComposerRailRow[]> {
    return computed(() => {
      // FormGroup validity isn't reactive on its own — the revision signal is what makes it one.
      this.formService.revision();

      const sections = this.sections;
      const activeSection = this.composer.activeSection();
      const visited = this.composer.visitedSections();
      const isEditMode = this.composer.isEditMode();
      const validById = new Map<MeetingComposerSectionId, boolean>(sections.map((section) => [section.id, this.formService.isSectionValid(section.id)]));
      const isComplete = (section: MeetingComposerSection): boolean => (section.required ? (validById.get(section.id) ?? false) : visited.has(section.id));

      return sections.map((section, index) => {
        const active = section.id === activeSection;
        const blockedByEarlier = sections.slice(0, index).some((earlier) => earlier.required && !validById.get(earlier.id));

        return {
          section,
          active,
          complete: isComplete(section) && !active,
          // The organizer can be standing on a section an out-of-section validator has just invalidated
          // (enabling YouTube upload tightens the title's max length), so never lock the row they're on.
          locked: !isEditMode && blockedByEarlier && !active,
          // Shared with the compact badge in the host, so the two can't disagree about what needs fixing.
          needsAttention: this.formService.sectionNeedsAttention(section, visited),
          lineBelowComplete: isComplete(section),
          isLast: index === sections.length - 1,
        };
      });
    });
  }
}
