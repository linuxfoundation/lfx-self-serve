// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, type Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  lfxColors,
  MEETING_JOIN_RESTRICTION_OPTIONS,
  MEETING_VISIBILITY_OPTIONS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
  YOUTUBE_MEETING_TITLE_WARNING_LENGTH,
} from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import type { CardSelectorOption } from '@lfx-one/shared/interfaces';
import { getSelectableMeetingTypeOptions } from '@lfx-one/shared/utils';
import { PersonaService } from '@services/persona.service';
import { map, of, startWith, switchMap } from 'rxjs';

import { MeetingComposerFormService } from '../meeting-composer-form.service';

/**
 * Details & Access section of the meeting composer (GH-1453).
 * @description Owns `title`, `meeting_type`, `visibility`, and `restricted`. Visibility and join
 * restriction are separate API fields with separate effects, so they render as two rows of one card
 * rather than as a single "privacy" control.
 */
@Component({
  selector: 'lfx-composer-details-access',
  imports: [NgClass, ReactiveFormsModule, InputTextComponent, SelectComponent, RadioButtonComponent],
  templateUrl: './composer-details-access.component.html',
})
export class ComposerDetailsAccessComponent {
  private readonly personaService = inject(PersonaService);
  private readonly formService = inject(MeetingComposerFormService);

  public readonly form = input.required<FormGroup>();
  /** Quick create renders these fields under its own dialog header, where a section heading only repeats it. */
  public readonly showHeading = input(true);
  /** Quick create renders the type as its own chip row above these fields, so the select would duplicate it. */
  public readonly showTypeSelect = input(true);
  /**
   * Hint text for a title that was written by something other than the organizer.
   * @description Passed in rather than derived here because only quick create prefills from the meeting
   * type. It renders directly under the input and is wired through `aria-describedby`, so the hint is
   * reachable from the field it is about instead of sitting at the bottom of the column.
   */
  public readonly titleHint = input<string | null>(null);

  protected readonly visibilityOptions = MEETING_VISIBILITY_OPTIONS;
  protected readonly joinRestrictionOptions = MEETING_JOIN_RESTRICTION_OPTIONS;
  protected readonly youtubeTitleLimit = YOUTUBE_MAX_MEETING_TITLE_LENGTH;
  protected readonly youtubeAmberThreshold = YOUTUBE_MEETING_TITLE_WARNING_LENGTH;

  /**
   * Icon chip styling for the visibility / join-restriction rows.
   * @description Unselected reads as a muted affordance; the selected row fills the chip with the option's
   * own colour (set inline, since the palette is per-option) and flips the glyph to white, so the answer is
   * legible without reading the radio. Whole class strings — Tailwind only emits what it can see literally.
   */
  protected readonly iconChipClass = 'bg-gray-100 text-gray-400';
  protected readonly iconChipSelectedClass = 'text-white';

  // FormGroup state isn't reactive, so both read `revision()` before touching the control.
  protected readonly selectedVisibility: Signal<string | null> = this.initSelectedVisibility();
  protected readonly selectedRestricted: Signal<boolean | null> = this.initSelectedRestricted();
  /** Drives the option rows' own check mark, which sits on the right rather than PrimeNG's left tick. */
  protected readonly selectedMeetingType: Signal<MeetingType | null> = this.initSelectedMeetingType();

  protected readonly titleLength: Signal<number> = this.initTitleLength();
  /**
   * Ids the title input points at through `aria-describedby`.
   * @description Built here rather than bound inline because the input takes a single attribute value:
   * the prefill hint and the two error messages all describe the same field, so they have to be joined
   * into one list instead of overwriting each other.
   */
  protected readonly titleDescribedBy: Signal<string | null> = this.initTitleDescribedBy();
  private readonly hydratedMeetingType: Signal<MeetingType | null> = this.initHydratedMeetingType();
  protected readonly meetingTypeOptions: Signal<CardSelectorOption<MeetingType>[]> = this.initMeetingTypeOptions();

  private initSelectedVisibility(): Signal<string | null> {
    return computed(() => {
      this.formService.revision();
      return (this.form().get('visibility')?.value as string | null) ?? null;
    });
  }

  private initSelectedMeetingType(): Signal<MeetingType | null> {
    return computed(() => {
      this.formService.revision();
      return (this.form().get('meeting_type')?.value as MeetingType | null) ?? null;
    });
  }

  private initSelectedRestricted(): Signal<boolean | null> {
    return computed(() => {
      this.formService.revision();
      return (this.form().get('restricted')?.value as boolean | null) ?? null;
    });
  }

  private initTitleLength(): Signal<number> {
    return toSignal(
      toObservable(this.form).pipe(
        switchMap((form) => {
          const control = form.get('title');
          if (!control) return of(0);
          return control.valueChanges.pipe(
            startWith(control.value as string | null),
            map((value: string | null) => value?.length ?? 0)
          );
        })
      ),
      { initialValue: 0 }
    );
  }

  private initTitleDescribedBy(): Signal<string | null> {
    return computed(() => {
      // FormGroup state isn't reactive; `revision` is what re-evaluates the error gates below.
      this.formService.revision();

      const title = this.form().get('title');
      // Deliberately not gated on `touched`, unlike the paragraphs themselves: a blur-driven
      // `markAsTouched()` emits on neither `valueChanges` nor `statusChanges`, so this would keep a stale
      // list through exactly the case the errors exist for — tabbing out of an empty title. An id whose
      // element isn't rendered yet is ignored when the accessibility tree resolves the list, so listing it
      // early is inert; the cost is that the attribute can name an id no element has yet, which linters
      // like axe report even though assistive tech doesn't care. Keeping both sides gated would mean
      // bumping `revision` on blur, and the form service owns that signal for the whole composer — a
      // per-field blur writing to it is a wider change than the association it would buy.
      const ids = [
        this.titleHint() ? 'composer-title-hint' : null,
        title?.errors?.['required'] ? 'composer-title-required-error' : null,
        title?.errors?.['maxlength'] ? 'composer-title-maxlength-error' : null,
      ].filter((id): id is string => id !== null);

      return ids.length ? ids.join(' ') : null;
    });
  }

  // Reads the loaded meeting rather than the control: the retained option has to stay the *stored*
  // type, or switching away from it — or remounting this section — would drop it from the list. Signal
  // state also means this survives hydration landing after the section renders.
  private initHydratedMeetingType(): Signal<MeetingType | null> {
    return computed(() => (this.formService.meeting()?.meeting_type as MeetingType | null) || null);
  }

  private initMeetingTypeOptions(): Signal<CardSelectorOption<MeetingType>[]> {
    return computed(() => {
      const hydrated = this.hydratedMeetingType();
      // Editing a meeting whose type this persona can't create would otherwise drop the stored value
      // out of the list, rendering the select as an empty placeholder over a populated control.
      const available = getSelectableMeetingTypeOptions(this.personaService.currentPersona(), hydrated);

      if (!hydrated || available.some((option) => option.value === hydrated)) {
        return available;
      }

      // Upstream types this field as a free-form string, so a stored type we don't have a card for is
      // possible. Synthesize an entry rather than leave the select looking empty over a valid control.
      return [...available, this.buildUnknownMeetingTypeOption(hydrated)];
    });
  }

  private buildUnknownMeetingTypeOption(meetingType: MeetingType): CardSelectorOption<MeetingType> {
    return {
      label: meetingType,
      value: meetingType,
      info: {
        icon: 'fa-light fa-calendar',
        description: 'Existing meeting type',
        color: lfxColors.gray[500],
      },
    };
  }
}
