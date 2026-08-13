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
  protected readonly youtubeAmberThreshold = Math.floor(YOUTUBE_MAX_MEETING_TITLE_LENGTH * 0.9);

  protected readonly meetingTypeOptions: Signal<CardSelectorOption<MeetingType>[]> = computed(() =>
    this.personaService.currentPersona() === 'maintainer'
      ? MEETING_TYPE_OPTIONS.filter((option) => MAINTAINER_MEETING_TYPES.includes(option.value))
      : MEETING_TYPE_OPTIONS
  );

  protected readonly titleLength: Signal<number> = this.initTitleLength();

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
}
