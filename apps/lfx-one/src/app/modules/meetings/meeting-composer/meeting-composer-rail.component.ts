// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { afterRenderEffect, Component, computed, ElementRef, inject, input, type Signal } from '@angular/core';
import { MEETING_COMPOSER_SECTIONS } from '@lfx-one/shared/constants';
import type { MeetingComposerRailRow, MeetingComposerSection, MeetingComposerSectionId } from '@lfx-one/shared/interfaces';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * Section navigation for the meeting composer (GH-1459).
 * @description Create mode is a progress stepper: a completed section shows its own icon in blue, the
 * current one is filled, and a visited-but-invalid required section carries an attention dot. Rows the
 * organizer hasn't reached yet are inert — reachable means visited, or the one section past the furthest
 * they've been, and never past a required section that still has holes in it. Edit mode is free navigation. `compact` renders either mode as a horizontal chip row,
 * which is what the composer shows below `lg` where the rail column is hidden (GH-1462).
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
   * @description What the composer shows below `lg`, where the rail column is hidden: the same rows,
   * laid out to fit above the section content.
   */
  public readonly compact = input(false);

  private readonly sections: readonly MeetingComposerSection[] = MEETING_COMPOSER_SECTIONS;

  /**
   * Single mode source for layout and the active marker.
   * @description Read from the form service because that is what `sectionNeedsAttention` reads — the other
   * mode-dependent input to a row — and because `composer.context()` is written before `initialize()` runs,
   * so a context-derived reader would lead this one by a flush. Taking mode from both would render the flat
   * edit rows while numbering them like create-mode steps.
   */
  protected readonly isEditMode: Signal<boolean> = this.formService.isEditMode;

  protected readonly rows: Signal<MeetingComposerRailRow[]> = this.initRows();
  // Both layouts can be in the DOM at once, so their test ids have to differ.
  protected readonly testIdPrefix: Signal<string> = computed(() => (this.compact() ? 'meeting-composer-rail-compact' : 'meeting-composer-rail'));
  // Edit mode has no ordering and no Next/Back, so announcing a step would describe a wizard that
  // isn't there — matching what the desktop edit rows already do.
  protected readonly activeChipAriaCurrent: Signal<'step' | 'true'> = computed(() => (this.isEditMode() ? 'true' : 'step'));

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
    if (row.active || !row.reachable) {
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
      const validById = new Map<MeetingComposerSectionId, boolean>(sections.map((section) => [section.id, this.formService.isSectionValid(section.id)]));
      // A section only reads as done once the organizer has actually been there: Date & Schedule validates
      // straight out of the box from its defaults, and a check mark on a section nobody has opened yet
      // claims work that didn't happen.
      const isComplete = (section: MeetingComposerSection): boolean =>
        visited.has(section.id) && (section.required ? (validById.get(section.id) ?? false) : true);
      // Create mode advances one section at a time, so the frontier is the section right after the
      // furthest one visited. Edit mode has no order to respect.
      const frontier = sections.reduce((furthest, section, index) => (visited.has(section.id) ? index : furthest), 0) + 1;
      // Nothing past the first required section that still has holes in it: the rail can't be a way
      // around the footer's disabled Next.
      const firstBlocking = sections.findIndex((section) => section.required && !validById.get(section.id));
      const blockedAt = firstBlocking === -1 ? sections.length : firstBlocking;
      const isEditMode = this.isEditMode();

      return sections.map((section, index) => {
        const active = section.id === activeSection;

        return {
          section,
          active,
          complete: isComplete(section) && !active,
          // Shared with the compact badge in the host, so the two can't disagree about what needs fixing.
          needsAttention: this.formService.sectionNeedsAttention(section, visited),
          reachable: isEditMode || (index <= blockedAt && (visited.has(section.id) || index <= frontier)),
          isLast: index === sections.length - 1,
        };
      });
    });
  }
}
