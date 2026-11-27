// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { REDDIT_PIXEL_PICKER_LOADING } from '@lfx-one/shared/constants';
import type { RedditPixelPickerState, RedditPixelPickerView } from '@lfx-one/shared/interfaces';
import { redditPixelPickerReason, redditPixelPickerView } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * The Reddit conversion pixel as a pick from the ad account's pixels (#6108 row 5), sent as the existing
 * `redditConfig.conversionPixelId`. "Use the connection's pixel" (blank) is the default. When the list cannot be read
 * (403 without `global_marketing_ops`, 503, any failure) or is empty, a typed pixel id is the way in, as before. The parent
 * shows this only when the pixel override and the pixel list are both an explicit yes, owns the id and sends it.
 */
@Component({
  selector: 'lfx-reddit-pixel-picker',
  imports: [UiInputComponent, UiOptionComponent, UiSelectComponent],
  templateUrl: './reddit-pixel-picker.component.html',
})
export class RedditPixelPickerComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();

  /** The pixel id as held: blank is the connection's pixel. Typed text is kept as typed; the request trims it. */
  public readonly pixelId = model.required<string>();

  protected readonly loadingText = REDDIT_PIXEL_PICKER_LOADING;
  protected readonly typedHint = "Find it in Reddit Ads under Events Manager. Leave it blank to use the pixel on this project's Reddit connection.";

  protected readonly picker: Signal<RedditPixelPickerState> = this.initPicker();
  /** The held id as the select compares it. */
  protected readonly heldId = computed<string>(() => this.pixelId().trim());
  protected readonly view = computed<RedditPixelPickerView>(() => redditPixelPickerView(this.picker(), this.pixelId()));

  protected onPick(value: string | null): void {
    this.pixelId.set(value ?? '');
  }

  protected onType(value: string): void {
    this.pixelId.set(value);
  }

  /** The ad account's pixels, read whenever the project changes. A failure keeps the typed box, with why. */
  private initPicker(): Signal<RedditPixelPickerState> {
    const state = (status: RedditPixelPickerState['status'], reason: string | null = null): RedditPixelPickerState => ({
      status,
      pixels: [],
      truncated: false,
      reason,
    });
    return toSignal(
      toObservable(this.projectSlug).pipe(
        switchMap((projectSlug) => {
          if (projectSlug === '') return of(state('idle'));
          return this.campaignService.getRedditPixels(projectSlug).pipe(
            map((result): RedditPixelPickerState => ({ status: 'loaded', pixels: result.pixels, truncated: result.truncated, reason: null })),
            catchError((err: unknown) => {
              console.error('Failed to read the Reddit pixels:', err);
              return of(state('unavailable', redditPixelPickerReason(err instanceof HttpErrorResponse ? err.status : 0)));
            }),
            startWith(state('loading'))
          );
        })
      ),
      { initialValue: state('idle') }
    );
  }
}
