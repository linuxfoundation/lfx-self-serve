// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CREATIVE_ASSET_MIME_TYPES, META_CAROUSEL_MAX_CARDS, META_CAROUSEL_MIN_CARDS } from '@lfx-one/shared/constants';
import type { CreativeAssetLibraryState, MetaCarouselCardDraft, MetaCarouselCardView } from '@lfx-one/shared/interfaces';
import { linkedInCarouselImagesNote, metaCarouselCardViews, moveLinkedInCarouselCard, newMetaCarouselCardDraft } from '@lfx-one/shared/utils';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';

/**
 * The Meta carousel editor on the Implement tab (#6331): the ad's one message and 2 to 10 cards, each an image (a stored
 * one from the brief's library or a pasted URL), a headline and an optional description, added, removed and reordered
 * here. The parent owns the cards, the library read and the upload, sends them as `metaConfig.variants`, and holds Create;
 * the rules live in `campaign-meta-carousel.utils.ts`.
 */
@Component({
  selector: 'lfx-meta-carousel-editor',
  imports: [ButtonComponent, UiInputComponent, UiOptionComponent, UiSelectComponent, UiTextareaComponent],
  templateUrl: './meta-carousel-editor.component.html',
})
export class MetaCarouselEditorComponent {
  public readonly cards = model.required<MetaCarouselCardDraft[]>();
  /** The one message, sent as card 1's primary text. */
  public readonly message = model.required<string>();
  /** The brief's stored images each card picks from, as the parent read them. */
  public readonly library = input<CreativeAssetLibraryState>({ status: 'idle', assets: [] });
  /** The brief the cards' stored images are for; a pick records it. */
  public readonly briefId = input('');
  /** Whether stored images may be picked and uploaded: an explicit yes from the Meta upload capability. */
  public readonly uploadAvailable = input(false);
  /** Whether a card may carry a pasted image URL: an explicit yes from the Meta image capability. */
  public readonly urlAvailable = input(false);
  /** Files chosen to upload into the brief's library; the parent queues them, and they are offered once stored. */
  public readonly upload = output<File[]>();

  protected readonly minCards = META_CAROUSEL_MIN_CARDS;
  protected readonly maxCards = META_CAROUSEL_MAX_CARDS;
  protected readonly imageAccept = CREATIVE_ASSET_MIME_TYPES.join(',');
  protected readonly views = computed<MetaCarouselCardView[]>(() => metaCarouselCardViews(this.cards(), this.library(), this.briefId()));
  protected readonly imagesNote = computed(() => (this.uploadAvailable() ? linkedInCarouselImagesNote(this.library()) : ''));

  protected onTextChange(key: string, field: 'headline' | 'description' | 'imageUrl', value: string): void {
    this.cards.update((cards) => cards.map((card) => (card.key === key ? { ...card, [field]: value } : card)));
  }

  /** A picked stored image, recorded with the brief it was picked for; `''` (the "No image" option) clears it. */
  protected onImagePick(key: string, value: string | null): void {
    const id = value ?? '';
    const briefId = id === '' ? '' : this.briefId();
    this.cards.update((cards) => cards.map((card) => (card.key === key ? { ...card, imageAssetId: id, imageAssetBriefId: briefId } : card)));
  }

  protected add(): void {
    this.cards.update((cards) => (cards.length >= META_CAROUSEL_MAX_CARDS ? cards : [...cards, newMetaCarouselCardDraft(cards)]));
  }

  protected remove(key: string): void {
    this.cards.update((cards) => (cards.length <= META_CAROUSEL_MIN_CARDS ? cards : cards.filter((card) => card.key !== key)));
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
