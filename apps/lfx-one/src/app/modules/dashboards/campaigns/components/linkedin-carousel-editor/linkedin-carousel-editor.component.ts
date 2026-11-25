// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CREATIVE_ASSET_MIME_TYPES, LINKEDIN_CAROUSEL_LIMITS } from '@lfx-one/shared/constants';
import type { CreativeAssetLibraryState, LinkedInCarouselCardDraft, LinkedInCarouselCardView } from '@lfx-one/shared/interfaces';
import {
  linkedInCarouselCardViews,
  linkedInCarouselImagesNote,
  linkedInCreativeTextLength,
  moveLinkedInCarouselCard,
  newLinkedInCarouselCardDraft,
} from '@lfx-one/shared/utils';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';

/**
 * The LinkedIn carousel editor on the Implement tab (linuxfoundation/lfx-v2-campaign-service#665): the post's intro text
 * and 2 to 10 cards, each a square image picked from the brief's library, a headline and an optional link, added, removed
 * and reordered here. The parent owns the cards, the library read and the upload, sends them, and holds Create; the rules
 * live in `campaign-linkedin-carousel-form.utils.ts`.
 */
@Component({
  selector: 'lfx-linkedin-carousel-editor',
  imports: [ButtonComponent, UiInputComponent, UiOptionComponent, UiSelectComponent, UiTextareaComponent],
  templateUrl: './linkedin-carousel-editor.component.html',
})
export class LinkedInCarouselEditorComponent {
  public readonly cards = model.required<LinkedInCarouselCardDraft[]>();
  public readonly introText = model.required<string>();
  /** The brief's stored images each card picks from, as the parent read them. */
  public readonly library = input<CreativeAssetLibraryState>({ status: 'idle', assets: [] });
  /** The brief the cards' images are stored for; a pick records it. */
  public readonly briefId = input('');
  /** Whether images may be uploaded into the brief's library from here: an explicit yes from the LinkedIn upload capability. */
  public readonly uploadAvailable = input(false);
  /** Files chosen to upload into the brief's library; the parent queues them, and they are offered once stored. */
  public readonly upload = output<File[]>();

  protected readonly limits = LINKEDIN_CAROUSEL_LIMITS;
  protected readonly imageAccept = CREATIVE_ASSET_MIME_TYPES.join(',');
  protected readonly views = computed<LinkedInCarouselCardView[]>(() => linkedInCarouselCardViews(this.cards(), this.library(), this.briefId()));
  protected readonly imagesNote = computed(() => linkedInCarouselImagesNote(this.library()));
  protected readonly introLength = computed(() => linkedInCreativeTextLength(this.introText()));

  protected onTextChange(key: string, field: 'headline' | 'destinationUrl', value: string): void {
    this.cards.update((cards) => cards.map((card) => (card.key === key ? { ...card, [field]: value } : card)));
  }

  /** A picked image, recorded with the brief it was picked for; `''` (the "No image" option) clears it. */
  protected onImagePick(key: string, value: string | null): void {
    const id = value ?? '';
    const briefId = id === '' ? '' : this.briefId();
    this.cards.update((cards) => cards.map((card) => (card.key === key ? { ...card, imageAssetId: id, imageAssetBriefId: briefId } : card)));
  }

  protected add(): void {
    this.cards.update((cards) => (cards.length >= LINKEDIN_CAROUSEL_LIMITS.maxCards ? cards : [...cards, newLinkedInCarouselCardDraft(cards)]));
  }

  protected remove(key: string): void {
    this.cards.update((cards) => (cards.length <= LINKEDIN_CAROUSEL_LIMITS.minCards ? cards : cards.filter((card) => card.key !== key)));
  }

  protected move(key: string, step: -1 | 1): void {
    this.cards.update((cards) => moveLinkedInCarouselCard(cards, key, step));
  }

  /** Hand the chosen files to the parent and clear the chooser, so choosing the same file again is a new selection. */
  protected onFiles(event: Event): void {
    const chooser = event.target as HTMLInputElement;
    const files = Array.from(chooser.files ?? []);
    chooser.value = '';
    if (files.length > 0) this.upload.emit(files);
  }
}
