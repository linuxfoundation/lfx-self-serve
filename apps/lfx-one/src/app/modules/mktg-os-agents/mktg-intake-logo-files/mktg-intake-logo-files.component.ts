// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, model, PLATFORM_ID, signal } from '@angular/core';
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
// body cannot carry before the run is refused on the way out. A read still
// in flight belongs to the context it started in: the run page cancels it
// on a project or user switch (`cancelReads`), and it ends with the section.
@Component({
  selector: 'lfx-mktg-intake-logo-files',
  imports: [ReactiveFormsModule, ButtonComponent, FileUploadComponent, InputTextComponent],
  templateUrl: './mktg-intake-logo-files.component.html',
})
export class MktgIntakeLogoFilesComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
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

  /** The reads in flight; `cancelReads` and the section's end drop them. */
  private readonly readers = new Set<FileReader>();

  public constructor() {
    // Only the readers go: the section is gone, so its models are not written.
    this.destroyRef.onDestroy(() => this.abortReads());
  }

  // === Public methods ===
  /**
   * Drops every read in flight, so a file picked for the previous project or
   * user never lands on the form the run page has just reset for the next
   * one: the section stays mounted across the switch.
   */
  public cancelReads(): void {
    this.abortReads();
    this.pending.set(0);
    this.busy.set(false);
    this.errorText.set('');
  }

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
    this.readers.add(reader);
    this.pending.update((count) => count + 1);
    this.busy.set(true);
    const done = (): void => {
      this.readers.delete(reader);
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

  /**
   * Every file goes on the form here, so the server's rules hold for each:
   * at most `maxFiles`, and each trimmed name once — a link can take the
   * name of an upload still being read, and the server refuses the whole
   * request on a repeated name.
   */
  private add(file: MktgIntakeLogoFile, badge: string, status: string): void {
    if (this.files().length >= this.config().maxFiles) {
      this.errorText.set(`At most ${this.config().maxFiles} files.`);
      return;
    }
    const name = file.name.trim();
    if (this.files().some((entry) => entry.file.name.trim() === name)) {
      this.errorText.set(`${name} is already on the form.`);
      return;
    }
    const id = `${badge.toLowerCase()}-${Date.now().toString(36)}-${this.files().length}`;
    this.files.update((files) => [...files, { id, file, badge, status }]);
  }

  /** Stops every read in flight without a callback: neither its file nor its error reaches the form. */
  private abortReads(): void {
    for (const reader of this.readers) {
      reader.onload = null;
      reader.onerror = null;
      reader.abort();
    }
    this.readers.clear();
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
    // Refused from its size before any read, so a large package is never
    // inflated into memory only to be refused; the read re-checks the exact length.
    const sentChars = this.sentCharsAtLeast(file);
    if (sentChars > this.config().maxFileChars) {
      return `${file.name} is too big to send with the form — add it as a link instead.`;
    }
    if (this.payloadChars() + sentChars > this.config().maxPayloadChars) {
      return `${file.name} would take the files over what one request can carry — add it as a link instead.`;
    }
    return '';
  }

  /**
   * The fewest characters a file can take on the form, from its byte size:
   * base64 is exactly four characters per three bytes, and an SVG's text is
   * at least a third of its UTF-8 bytes (no character takes more than three
   * bytes per UTF-16 unit), so nothing that would fit is refused here.
   */
  private sentCharsAtLeast(file: File): number {
    return brandKitLogoFileKind(file.name) === 'svg' ? Math.ceil(file.size / 3) : Math.ceil(file.size / 3) * 4;
  }

  /**
   * The file name a link stands for: the base name of its last path segment
   * once decoded (an encoded `/` or `\` is a separator, as the server's name
   * rule reads it), or the host when the path has none. The link itself is
   * sent to the agent as given.
   */
  private linkFileName(url: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return url;
    }
    const segment = parsed.pathname
      .split('/')
      .filter((part) => part !== '')
      .pop();
    if (segment === undefined) {
      return parsed.hostname;
    }
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // A malformed escape: the segment as written is still a file name.
    }
    const base = decoded
      .split(/[/\\\r\n]/)
      .filter((part) => part.trim() !== '')
      .pop();
    return base?.trim() ?? parsed.hostname;
  }
}
