// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, output } from '@angular/core';
import { CREATIVE_ASSET_DOCUMENT_MIME_TYPE, LINKEDIN_DOCUMENT_LIMITS } from '@lfx-one/shared/constants';
import type { CreativeAssetLibraryState, LinkedInDocumentDraft, LinkedInDocumentView } from '@lfx-one/shared/interfaces';
import { linkedInDocumentView } from '@lfx-one/shared/utils';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';

/**
 * The LinkedIn document ad editor on the Implement tab (linuxfoundation/lfx-v2-campaign-service#665): the PDF picked from
 * the brief's library, its title and the post's intro text. The parent owns the draft, the library read and the upload,
 * sends them, and holds Create; the rules live in `campaign-linkedin-document-form.utils.ts`.
 */
@Component({
  selector: 'lfx-linkedin-document-editor',
  imports: [UiInputComponent, UiOptionComponent, UiSelectComponent, UiTextareaComponent],
  templateUrl: './linkedin-document-editor.component.html',
})
export class LinkedInDocumentEditorComponent {
  public readonly document = model.required<LinkedInDocumentDraft>();
  /** The brief's stored PDFs the picker offers, as the parent read them. */
  public readonly library = input<CreativeAssetLibraryState>({ status: 'idle', assets: [] });
  /** The brief the PDF is stored for; a pick records it. */
  public readonly briefId = input('');
  /** The stored asset whose delete is running, `''` for none: the picker does not offer it, and the upload waits for it. */
  public readonly deletingAssetId = input('');
  /** Whether a PDF may be uploaded into the brief's library from here: an explicit yes from the LinkedIn upload capability. */
  public readonly uploadAvailable = input(false);
  /** The gated-document warning, or `''`: shown, never holding Create. */
  public readonly gatedWarning = input('');
  /** A PDF chosen to upload into the brief's library; the parent queues it, and it is offered once stored. */
  public readonly upload = output<File[]>();

  protected readonly limits = LINKEDIN_DOCUMENT_LIMITS;
  protected readonly pdfAccept = CREATIVE_ASSET_DOCUMENT_MIME_TYPE;
  protected readonly view = computed<LinkedInDocumentView>(() => linkedInDocumentView(this.document(), this.library(), this.briefId(), this.deletingAssetId()));

  protected onTextChange(field: 'title' | 'introText', value: string): void {
    this.document.update((document) => ({ ...document, [field]: value }));
  }

  /** A picked PDF, recorded with the brief it was picked for; `''` (the "No PDF" option) clears it. */
  protected onPdfPick(value: string | null): void {
    const assetId = value ?? '';
    const assetBriefId = assetId === '' ? '' : this.briefId();
    this.document.update((document) => ({ ...document, assetId, assetBriefId }));
  }

  /** Hand the chosen file to the parent and clear the chooser, so choosing the same file again is a new selection. */
  protected onFiles(event: Event): void {
    const chooser = event.target as HTMLInputElement;
    const files = Array.from(chooser.files ?? []);
    chooser.value = '';
    if (files.length > 0) this.upload.emit(files);
  }
}
