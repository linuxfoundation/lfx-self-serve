// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, model } from '@angular/core';
import {
  REDDIT_GENDER_LABELS,
  REDDIT_GENDERS,
  REDDIT_LANGUAGE_LABELS,
  REDDIT_LANGUAGES,
  REDDIT_MAX_SCHEDULE_WINDOWS,
  REDDIT_SCHEDULE_DAY_OPTIONS,
  REDDIT_SCHEDULE_HOUR_OPTIONS,
} from '@lfx-one/shared/constants';
import type { RedditDemographicsDraft, RedditScheduleWindowKey } from '@lfx-one/shared/interfaces';
import {
  redditGenderChoice,
  redditLanguagesChoice,
  redditScheduleWindowAdded,
  redditScheduleWindowRemoved,
  redditScheduleWindowWith,
} from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiMultiSelectComponent } from '@shared/uikit/multi-select/multi-select.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';

/**
 * Reddit gender, language and dayparting targeting on the Implement tab (#6108 row 9), sent as `redditConfig.gender`,
 * `languages` and `schedule`. Every control starts on its default (every gender, every language, any time), which the
 * request leaves out. The parent shows this only while the deployment sends them (`redditDemographicsEnabled`), owns the
 * choices, keeps them in the draft and holds Create on `refusal`; the rules live in `campaign-reddit-demographics.utils.ts`.
 */
@Component({
  selector: 'lfx-reddit-demographics',
  imports: [UiButtonComponent, UiMultiSelectComponent, UiOptionComponent, UiSelectComponent],
  templateUrl: './reddit-demographics.component.html',
})
export class RedditDemographicsComponent {
  /** Why the held choices would be refused (`redditDemographicsDraftRefusal`), or `null`. */
  public readonly refusal = input<string | null>(null);
  public readonly demographics = model.required<RedditDemographicsDraft>();

  protected readonly genders = REDDIT_GENDERS;
  protected readonly genderLabels = REDDIT_GENDER_LABELS;
  protected readonly languages = REDDIT_LANGUAGES;
  protected readonly languageLabels = REDDIT_LANGUAGE_LABELS;
  protected readonly maxWindows = REDDIT_MAX_SCHEDULE_WINDOWS;
  protected readonly dayOptions = REDDIT_SCHEDULE_DAY_OPTIONS;
  protected readonly hourOptions = REDDIT_SCHEDULE_HOUR_OPTIONS;

  protected onGenderChange(value: string | null): void {
    this.update({ gender: redditGenderChoice(value) });
  }

  protected onLanguagesChange(values: string[]): void {
    this.update({ languages: redditLanguagesChoice(values) });
  }

  protected onWindowChange(index: number, key: RedditScheduleWindowKey, value: string | null): void {
    this.update({ schedule: redditScheduleWindowWith(this.demographics().schedule, index, key, value) });
  }

  protected addWindow(): void {
    this.update({ schedule: redditScheduleWindowAdded(this.demographics().schedule) });
  }

  protected removeWindow(index: number): void {
    this.update({ schedule: redditScheduleWindowRemoved(this.demographics().schedule, index) });
  }

  private update(change: Partial<RedditDemographicsDraft>): void {
    this.demographics.update((current) => ({ ...current, ...change }));
  }
}
