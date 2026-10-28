// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { SelectComponent } from '@components/select/select.component';
import type { GoogleCreativeImageSlotView } from '@lfx-one/shared/interfaces';
import type { FileSelectEvent } from 'primeng/fileupload';

/**
 * One Google creative image slot's stored-image controls: the images held in it, a picker over the
 * brief's library narrowed to the images that fit the slot, and an upload into that library.
 *
 * Presentational. The Implement tab owns every piece of state — which images are held, the upload
 * in flight, the library read — and hands this a finished {@link GoogleCreativeImageSlotView}, so
 * the payload, the draft and the Create block all read the one copy. This only renders it and says
 * what the operator did.
 */
@Component({
  selector: 'lfx-google-creative-image-library',
  imports: [ReactiveFormsModule, ButtonComponent, FileUploadComponent, SelectComponent],
  templateUrl: './google-creative-image-library.component.html',
})
export class GoogleCreativeImageLibraryComponent {
  // === Private Injections / Queries ===
  private readonly uploader = viewChild(FileUploadComponent);

  // === Inputs ===
  public readonly slot = input.required<GoogleCreativeImageSlotView>();
  /** The `accept` list for the file chooser — `CREATIVE_ASSET_MIME_TYPES`, joined by the host. */
  public readonly accept = input('');

  // === Outputs ===
  /** A library image chosen for this slot, by asset id. */
  public readonly pick = output<string>();
  /** A held image taken out of this slot, by asset id. The stored asset stays in the library. */
  public readonly remove = output<string>();
  /** A file chosen to upload into the library and hold in this slot. */
  public readonly upload = output<File>();
  /** Abandon the upload running for this slot. */
  public readonly cancelUpload = output<void>();

  // === Forms ===
  /**
   * The picker's own control. Reset after every pick: it is an "add" action rather than a value
   * the slot keeps, and what the slot holds is the host's `held` list.
   */
  protected readonly pickForm = new FormGroup({ asset: new FormControl('', { nonNullable: true }) });

  // === Protected Methods ===
  protected onPick(): void {
    const id = this.pickForm.controls.asset.value;
    this.pickForm.controls.asset.setValue('', { emitEvent: false });
    if (id) this.pick.emit(id);
  }

  /**
   * Hand the chosen file to the host and clear the chooser, so choosing the same file again — after
   * a failed upload, say — is a new selection rather than no change.
   */
  protected onFileSelect(event: FileSelectEvent): void {
    const file = event.files?.[0];
    this.uploader()?.clear();
    if (file) this.upload.emit(file);
  }
}
