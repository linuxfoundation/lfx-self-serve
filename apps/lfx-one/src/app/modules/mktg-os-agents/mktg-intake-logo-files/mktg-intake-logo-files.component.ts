// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, model, PLATFORM_ID, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MktgIntakeLogoFile, MktgIntakeLogoFileEntry, MktgIntakeLogoFilesConfig } from '@lfx-one/shared/interfaces';
import { brandKitLogoFileKind } from '@lfx-one/shared/utils';
import { httpsUrlValidator } from '@lfx-one/shared/validators';
import type { FileSelectEvent } from 'primeng/fileupload';

// The logo-files section of an intake (the Brand Kit's artwork): SVG, PNG
// and ZIP files, read in the browser as soon as they are picked — an SVG as
// its text, a PNG or a ZIP as its base64 bytes — and sent with the form; and
// links to files on the site, which the agent fetches itself. The section
// says what the agent will get for each, and refuses what the one request
// body cannot carry before the run is refused on the way out.
@Component({
  selector: 'lfx-mktg-intake-logo-files',
  imports: [ReactiveFormsModule, ButtonComponent, FileUploadComponent, InputTextComponent],
  templateUrl: './mktg-intake-logo-files.component.html',
})
export class MktgIntakeLogoFilesComponent {
  // === Injections ===
  private readonly platformId = inject(PLATFORM_ID);

  // === Inputs ===
  public readonly config = input.required<MktgIntakeLogoFilesConfig>();

  // === Forms ===
  protected readonly linkForm = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [httpsUrlValidator()] }),
  });

  // === Model signals ===
  /** The files on the form, in the order added. */
  public readonly files = model<MktgIntakeLogoFileEntry[]>([]);
  /** True while a file is still being read — the run must not start without it. */
  public readonly busy = model(false);

  // === Signals ===
  protected readonly pending = signal(0);
  protected readonly errorText = signal('');

  // === Computed ===
  protected readonly atLimit = computed(() => this.files().length + this.pending() >= this.config().maxFiles);
  protected readonly acceptAttribute = computed(() => this.config().fileExtensions.join(','));
  /** Characters the files on the form already take of the one request body. */
  private readonly payloadChars = computed(() => this.files().reduce((total, entry) => total + (entry.file.text ?? entry.file.base64 ?? '').length, 0));

  // === Protected methods ===
  /** A link is listed as given and sent to the agent as its URL; nothing is read here. */
  protected onAddLink(): void {
    const control = this.linkForm.controls.url;
    const url = control.value.trim();
    if (!url || control.invalid) {
      this.errorText.set('Enter the full link to the file, starting with https://.');
      return;
    }
    if (this.atLimit()) {
      this.errorText.set(`At most ${this.config().maxFiles} files.`);
      return;
    }
    const name = this.linkFileName(url);
    if (this.files().some((entry) => entry.file.name === name)) {
      this.errorText.set(`${name} is already on the form.`);
      return;
    }
    this.errorText.set('');
    this.add({ name, url }, 'LINK', 'the agent fetches it');
    control.reset('');
  }

  protected onFilesSelected(event: FileSelectEvent): void {
    // `files` is this selection only (`currentFiles` is everything the uploader has seen); the uploader resets its input itself.
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.errorText.set('');
    for (const file of Array.from(event.files)) {
      const rejection = this.fileRejection(file);
      if (rejection) {
        this.errorText.set(rejection);
        continue;
      }
      this.read(file);
    }
  }

  protected onRemove(id: string): void {
    this.files.update((files) => files.filter((entry) => entry.id !== id));
  }

  // === Private helpers ===
  /** Reads one picked file: an SVG as its text, anything else as its base64 bytes. */
  private read(file: File): void {
    const kind = brandKitLogoFileKind(file.name);
    const reader = new FileReader();
    this.pending.update((count) => count + 1);
    this.busy.set(true);
    const done = (): void => {
      this.pending.update((count) => count - 1);
      this.busy.set(this.pending() > 0);
    };
    reader.onload = () => {
      done();
      const result = typeof reader.result === 'string' ? reader.result : '';
      const content = kind === 'svg' ? result : result.slice(result.indexOf(',') + 1);
      if (!content) {
        this.errorText.set(`${file.name}: the file is empty.`);
        return;
      }
      if (content.length > this.config().maxFileChars) {
        this.errorText.set(`${file.name} is too big to send with the form — add it as a link instead.`);
        return;
      }
      if (this.payloadChars() + content.length > this.config().maxPayloadChars) {
        this.errorText.set(`${file.name} would take the files over what one request can carry — add it as a link instead.`);
        return;
      }
      const size = `${Math.max(1, Math.round(file.size / 1024)).toLocaleString('en-US')} KB`;
      if (kind === 'svg') {
        this.add({ name: file.name, text: content }, 'SVG', `${size}, sent as text`);
      } else {
        this.add({ name: file.name, base64: content }, kind.toUpperCase(), `${size}, sent as bytes`);
      }
    };
    reader.onerror = () => {
      done();
      this.errorText.set(`${file.name}: the file could not be read. Try again, or add it as a link.`);
    };
    if (kind === 'svg') {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
    }
  }

  private add(file: MktgIntakeLogoFile, badge: string, status: string): void {
    if (this.files().length >= this.config().maxFiles) {
      this.errorText.set(`At most ${this.config().maxFiles} files.`);
      return;
    }
    const id = `${badge.toLowerCase()}-${Date.now().toString(36)}-${this.files().length}`;
    this.files.update((files) => [...files, { id, file, badge, status }]);
  }

  private fileRejection(file: File): string {
    const name = file.name.toLowerCase();
    if (!this.config().fileExtensions.some((extension) => name.endsWith(extension))) {
      return `${file.name}: not an SVG, PNG or ZIP file.`;
    }
    if (this.files().some((entry) => entry.file.name === file.name)) {
      return `${file.name} is already on the form.`;
    }
    if (this.atLimit()) {
      return `At most ${this.config().maxFiles} files.`;
    }
    return '';
  }

  /** The file name a link stands for: its last path segment, or the host when the path has none. */
  private linkFileName(url: string): string {
    try {
      const parsed = new URL(url);
      const segment = parsed.pathname
        .split('/')
        .filter((part) => part !== '')
        .pop();
      return decodeURIComponent(segment ?? parsed.hostname);
    } catch {
      return url;
    }
  }
}
