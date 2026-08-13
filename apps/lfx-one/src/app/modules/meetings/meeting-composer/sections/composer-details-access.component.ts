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
  MAINTAINER_MEETING_TYPES,
  MEETING_JOIN_RESTRICTION_OPTIONS,
  MEETING_TYPE_OPTIONS,
  MEETING_VISIBILITY_OPTIONS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
  YOUTUBE_MEETING_TITLE_WARNING_LENGTH,
} from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import type { CardSelectorOption } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';
import { map, of, startWith, switchMap } from 'rxjs';

/**
 * Details & Access section of the meeting composer (LFXV2-3235).
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

  public readonly form = input.required<FormGroup>();

  protected readonly visibilityOptions = MEETING_VISIBILITY_OPTIONS;
  protected readonly joinRestrictionOptions = MEETING_JOIN_RESTRICTION_OPTIONS;
  protected readonly youtubeTitleLimit = YOUTUBE_MAX_MEETING_TITLE_LENGTH;
  protected readonly youtubeAmberThreshold = YOUTUBE_MEETING_TITLE_WARNING_LENGTH;

  protected readonly titleLength: Signal<number> = this.initTitleLength();
  protected readonly meetingTypeOptions: Signal<CardSelectorOption<MeetingType>[]> = this.initMeetingTypeOptions();

  private readonly hydratedMeetingType: Signal<MeetingType | null> = this.initHydratedMeetingType();

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

  // Reads the control once per form instance rather than tracking valueChanges: the retained option has
  // to stay the *hydrated* type, or switching away from it would drop it from the list permanently.
  private initHydratedMeetingType(): Signal<MeetingType | null> {
    return computed(() => (this.form().get('meeting_type')?.value as MeetingType | null) ?? null);
  }

  private initMeetingTypeOptions(): Signal<CardSelectorOption<MeetingType>[]> {
    return computed(() => {
      if (this.personaService.currentPersona() !== 'maintainer') {
        return MEETING_TYPE_OPTIONS;
      }

      // Editing a meeting whose type this persona can't create would otherwise drop the stored value
      // out of the list, rendering the select as an empty placeholder over a populated control.
      const hydrated = this.hydratedMeetingType();

      return MEETING_TYPE_OPTIONS.filter((option) => MAINTAINER_MEETING_TYPES.includes(option.value) || option.value === hydrated);
    });
  }
}
