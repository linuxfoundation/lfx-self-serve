// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, model, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { FOUNDATION_MESSAGE_READ_REASONS } from '@lfx-one/shared/constants';
import { MktgDocumentExtractResponse, MktgIntakeDocumentEntry, MktgIntakeDocumentRow, MktgIntakeDocumentsConfig } from '@lfx-one/shared/interfaces';
import { sourceUrlValidator } from '@lfx-one/shared/validators';
import type { FileSelectEvent } from 'primeng/fileupload';
import { finalize, Observable } from 'rxjs';

import { MktgIntakeDocumentsService } from '@services/mktg-intake-documents.service';

// The optional existing-documents section of an intake (the Messaging
// Document's Step 0a): links and uploaded files, each read to text by the BFF
// as soon as it is added, so the user sees what the agent will get — "fetched
// · 6,100 words", or why it could not be read — before generating.
@Component({
  selector: 'lfx-mktg-intake-documents',
  imports: [NgClass, ReactiveFormsModule, ButtonComponent, FileUploadComponent, InputTextComponent],
  templateUrl: './mktg-intake-documents.component.html',
})
export class MktgIntakeDocumentsComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentsService = inject(MktgIntakeDocumentsService);

  // === Inputs ===
  public readonly config = input.required<MktgIntakeDocumentsConfig>();

  // === Forms ===
  protected readonly linkForm = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [sourceUrlValidator()] }),
  });

  // === Model signals ===
  /** The documents on the form, in the order added. */
  public readonly documents = model<MktgIntakeDocumentEntry[]>([]);
  /** True while any document is still being read — the run must not start without it. */
  public readonly busy = model(false);

  // === Signals ===
  protected readonly pending = signal(0);
  protected readonly errorText = signal('');

  // === Computed ===
  protected readonly rows: Signal<MktgIntakeDocumentRow[]> = this.initRows();
  protected readonly atLimit = computed(() => this.documents().length + this.pending() >= this.config().maxDocuments);
  protected readonly acceptAttribute = computed(() => this.config().fileExtensions.join(','));

  // Literal class names so Tailwind's content scan generates them.
  private readonly statusClass: Record<'read' | 'unread', string> = {
    read: 'text-emerald-700',
    unread: 'text-amber-700',
  };

  // === Protected methods ===
  protected onAddLink(): void {
    const control = this.linkForm.controls.url;
    const url = control.value.trim();
    if (!url || url.toLowerCase() === 'none' || control.invalid) {
      this.errorText.set('Enter the full link, starting with https://.');
      return;
    }
    if (this.atLimit()) {
      this.errorText.set(`At most ${this.config().maxDocuments} documents.`);
      return;
    }
    this.errorText.set('');
    this.track(this.documentsService.readLink(this.config(), url)).subscribe({
      next: (response) => this.add({ kind: 'link', url, ...this.entryFields(response) }),
      // A link that could not be checked still goes to the agent, as "not read".
      error: () =>
        this.add({ kind: 'link', url, title: url, read: false, words: 0, truncated: false, reason: FOUNDATION_MESSAGE_READ_REASONS['fetch-failed'] }),
    });
    control.reset('');
  }

  protected onFilesSelected(event: FileSelectEvent): void {
    // `files` is this selection only (`currentFiles` is everything the uploader has seen); the uploader resets its input itself.
    this.errorText.set('');
    for (const file of Array.from(event.files)) {
      const rejection = this.fileRejection(file);
      if (rejection) {
        this.errorText.set(rejection);
        continue;
      }
      this.track(this.documentsService.readFile(this.config(), file)).subscribe({
        next: (response) => {
          // A file the server could not read has no text to send: it is not added, and the user is told why.
          if (!response.read || !response.text) {
            this.errorText.set(`${file.name}: ${response.reason ?? FOUNDATION_MESSAGE_READ_REASONS['no-text']}`);
            return;
          }
          this.add({ kind: 'file', text: response.text, ...this.entryFields(response) });
        },
        error: () => this.errorText.set(`${file.name}: LFX One couldn’t read this file. Try again, or paste its text into a .txt file.`),
      });
    }
  }

  protected onRemove(id: string): void {
    this.documents.update((documents) => documents.filter((document) => document.id !== id));
  }

  // === Private initializers ===
  private initRows(): Signal<MktgIntakeDocumentRow[]> {
    return computed(() =>
      this.documents().map((document) => {
        const words = document.words.toLocaleString('en-US');
        let status = document.reason ?? 'not read';
        if (document.read) {
          status = `${document.kind === 'link' ? 'fetched' : 'read'} · ${words} words${document.truncated ? ' (cut to fit)' : ''}`;
        }
        return {
          id: document.id,
          badge: document.kind === 'link' ? 'LINK' : 'FILE',
          title: document.title,
          status,
          statusClass: this.statusClass[document.read ? 'read' : 'unread'],
        };
      })
    );
  }

  // === Private helpers ===
  private add(entry: Omit<MktgIntakeDocumentEntry, 'id'>): void {
    if (this.documents().length >= this.config().maxDocuments) {
      this.errorText.set(`At most ${this.config().maxDocuments} documents.`);
      return;
    }
    const id = `${entry.kind}-${Date.now().toString(36)}-${this.documents().length}`;
    this.documents.update((documents) => [...documents, { ...entry, id }]);
  }

  private entryFields(response: MktgDocumentExtractResponse): Pick<MktgIntakeDocumentEntry, 'title' | 'read' | 'words' | 'truncated' | 'reason'> {
    return {
      title: response.title,
      read: response.read,
      words: response.words,
      truncated: response.truncated,
      ...(response.reason && { reason: response.reason }),
    };
  }

  private fileRejection(file: File): string {
    const name = file.name.toLowerCase();
    if (!this.config().fileExtensions.some((extension) => name.endsWith(extension))) {
      return `${file.name}: ${FOUNDATION_MESSAGE_READ_REASONS.unsupported}`;
    }
    if (file.size > this.config().maxFileBytes) {
      return `${file.name}: ${FOUNDATION_MESSAGE_READ_REASONS['too-large']}`;
    }
    if (this.atLimit()) {
      return `At most ${this.config().maxDocuments} documents.`;
    }
    return '';
  }

  /** Counts a read in flight for the `busy` flag, for as long as it runs. */
  private track<T>(request: Observable<T>): Observable<T> {
    this.pending.update((count) => count + 1);
    this.busy.set(true);
    return request.pipe(
      finalize(() => {
        this.pending.update((count) => count - 1);
        this.busy.set(this.pending() > 0);
      }),
      takeUntilDestroyed(this.destroyRef)
    );
  }
}
