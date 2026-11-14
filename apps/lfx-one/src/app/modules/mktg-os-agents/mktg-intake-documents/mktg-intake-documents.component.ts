// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, model, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { FOUNDATION_MESSAGE_READ_REASONS, MKTG_DRIVE_SHARING_HINT } from '@lfx-one/shared/constants';
import {
  MktgDocumentExtractResponse,
  MktgIntakeDocumentEntry,
  MktgIntakeDocumentRow,
  MktgIntakeDocumentsConfig,
  MktgIntakeDocumentTag,
} from '@lfx-one/shared/interfaces';
import { mktgLinkWarnings } from '@lfx-one/shared/utils';
import { sourceUrlValidator } from '@lfx-one/shared/validators';
import type { FileSelectEvent } from 'primeng/fileupload';
import { combineLatest, finalize, Observable, Subject, takeUntil } from 'rxjs';

import { MktgIntakeDocumentsService } from '@services/mktg-intake-documents.service';

// The optional documents section of an intake (the Messaging Framework's):
// uploaded files, each read to text by the BFF as soon as it is added so the
// user sees what the agent will get — "read · 6,100 words", or why it could
// not be read — and links, which go to the agent as they are: it fetches
// them itself. Intakes that take a document kind offer a tag per document
// (press release, deck, document, plan, logo package).
@Component({
  selector: 'lfx-mktg-intake-documents',
  imports: [NgClass, ReactiveFormsModule, ButtonComponent, FileUploadComponent, InputTextComponent, SelectComponent],
  templateUrl: './mktg-intake-documents.component.html',
})
export class MktgIntakeDocumentsComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentsService = inject(MktgIntakeDocumentsService);

  // === Inputs ===
  public readonly config = input.required<MktgIntakeDocumentsConfig>();
  public readonly earlierUrls = input<string[]>([]);

  protected readonly driveSharingHint = MKTG_DRIVE_SHARING_HINT;

  // === Forms ===
  protected readonly linkForm = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [sourceUrlValidator()] }),
  });
  /** One tag control per document on the form (its id), for intakes with tags. */
  protected readonly tagsForm = new FormGroup<Record<string, AbstractControl<string>>>({});

  // === Model signals ===
  /** The documents on the form, in the order added. */
  public readonly documents = model<MktgIntakeDocumentEntry[]>([]);
  /** True while any document is still being read — the run must not start without it. */
  public readonly busy = model(false);

  // === Signals ===
  protected readonly pending = signal(0);
  protected readonly errorText = signal('');
  /** The documents whose tag control exists — the rows show a picker for these only. */
  private readonly tagControlIds = signal<Set<string>>(new Set());

  /** Fires to drop every read in flight (`cancelReads`). */
  private readonly cancelled$ = new Subject<void>();

  // === Computed ===
  private readonly pendingUrl = toSignal(this.linkForm.controls.url.valueChanges, { initialValue: '' });
  protected readonly linkWarnings = this.initLinkWarnings();
  protected readonly rows: Signal<MktgIntakeDocumentRow[]> = this.initRows();
  protected readonly atLimit = computed(() => this.documents().length + this.pending() >= this.config().maxDocuments);
  protected readonly acceptAttribute = computed(() => this.config().fileExtensions.join(','));
  /** The tags the intake offers per document; empty for intakes without tags. */
  protected readonly tagOptions: Signal<MktgIntakeDocumentTag[]> = computed(() => this.config().tags ?? []);
  protected readonly hasTags = computed(() => this.tagOptions().length > 0);
  /** The tag a new document gets: the intake's default, else the first option. */
  private readonly defaultTag = computed(() => this.config().defaultTag ?? this.tagOptions()[0]?.value ?? '');

  // Literal class names so Tailwind's content scan generates them.
  private readonly statusClass: Record<'read' | 'unread' | 'link', string> = {
    read: 'text-emerald-700',
    unread: 'text-amber-700',
    link: 'text-gray-500',
  };

  public constructor() {
    // The tag controls follow the documents: one per document on the form —
    // added for a document that arrived without one (set by the run page),
    // dropped when a document goes (removed by the user, or the whole list
    // emptied by a project switch). The ids with a control are a signal so
    // the rows render a picker only once its control exists.
    combineLatest([toObservable(this.documents), toObservable(this.hasTags)])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([documents, hasTags]) => this.syncTagControls(documents, hasTags));
  }

  // === Public methods ===
  /**
   * Drops every read still in flight, so a file picked for one intake is
   * never added to another: the run page keeps this section mounted across
   * a project or effective-user switch and empties `documents`, and a read
   * that answered after that would otherwise land in the new intake.
   */
  public cancelReads(): void {
    this.cancelled$.next();
    this.errorText.set('');
  }

  /**
   * Reads the given files to text and lists each one that has any, tagged
   * `tag` when given (a file picked on an intake field that names its kind —
   * the deck, the plan) and the intake's default kind otherwise. Public so the
   * run page's per-field uploads land in this one list, read the same way.
   */
  public addFiles(files: File[], tag?: string): void {
    this.errorText.set('');
    for (const file of files) {
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
          this.add({ kind: 'file', text: response.text, ...this.entryFields(response) }, tag);
        },
        error: () => this.errorText.set(`${file.name}: LFX One couldn’t read this file. Try again, or paste its text into a .txt file.`),
      });
    }
  }

  // === Protected methods ===
  /** A link is listed as given and sent to the agent as its URL; nothing is read here. */
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
    this.add({ kind: 'link', url, title: url, read: false, words: 0, truncated: false });
    control.reset('');
  }

  protected onFilesSelected(event: FileSelectEvent): void {
    // `files` is this selection only (`currentFiles` is everything the uploader has seen); the uploader resets its input itself.
    this.addFiles(Array.from(event.files));
  }

  protected onRemove(id: string): void {
    this.documents.update((documents) => documents.filter((document) => document.id !== id));
  }

  // === Private initializers ===
  private initLinkWarnings(): Signal<Record<string, string>> {
    return computed(() =>
      mktgLinkWarnings(
        {
          ...Object.fromEntries(
            this.documents()
              .filter((document) => document.kind === 'link')
              .map((document) => [document.id, document.url ?? ''])
          ),
          pending: this.pendingUrl(),
        },
        this.earlierUrls()
      )
    );
  }

  private initRows(): Signal<MktgIntakeDocumentRow[]> {
    return computed(() =>
      this.documents().map((document) => {
        const tagControl = this.tagControlIds().has(document.id) ? document.id : '';
        if (document.kind === 'link') {
          return { id: document.id, badge: 'LINK', title: document.title, status: 'the agent reads it', statusClass: this.statusClass.link, tagControl };
        }
        const words = document.words.toLocaleString('en-US');
        let status = document.reason ?? 'not read';
        if (document.read) {
          status = `read · ${words} words${document.truncated ? ' (cut to fit)' : ''}`;
        }
        return { id: document.id, badge: 'FILE', title: document.title, status, statusClass: this.statusClass[document.read ? 'read' : 'unread'], tagControl };
      })
    );
  }

  // === Private helpers ===
  /** Lists a document, tagged `tag` when given and the intake offers tags, else the intake's default kind. */
  private add(entry: Omit<MktgIntakeDocumentEntry, 'id'>, tag?: string): void {
    if (this.documents().length >= this.config().maxDocuments) {
      this.errorText.set(`At most ${this.config().maxDocuments} documents.`);
      return;
    }
    const id = `${entry.kind}-${Date.now().toString(36)}-${this.documents().length}`;
    const known = this.tagOptions().some((option) => option.value === tag);
    const tagged = this.hasTags() ? { tag: known && tag ? tag : this.defaultTag() } : {};
    this.documents.update((documents) => [...documents, { ...entry, ...tagged, id }]);
  }

  /** Reconciles the tag controls with the documents on the form: one control per document, none for a document that is gone. */
  private syncTagControls(documents: MktgIntakeDocumentEntry[], hasTags: boolean): void {
    const ids = new Set(documents.map((document) => document.id));
    for (const key of Object.keys(this.tagsForm.controls)) {
      if (!ids.has(key)) {
        this.tagsForm.removeControl(key);
      }
    }
    if (hasTags) {
      for (const document of documents) {
        if (!this.tagsForm.contains(document.id)) {
          this.addTagControl(document.id, document.tag ?? this.defaultTag());
        }
      }
    }
    this.tagControlIds.set(new Set(Object.keys(this.tagsForm.controls)));
  }

  /** One tag control for a document; the picker writes straight into the document it belongs to. */
  private addTagControl(id: string, tag: string): void {
    const control = new FormControl(tag, { nonNullable: true });
    this.tagsForm.addControl(id, control);
    control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.documents.update((documents) => documents.map((document) => (document.id === id ? { ...document, tag: value } : document)));
    });
    // A document that arrived without a tag (set by the run page) carries the control's from now on.
    this.documents.update((documents) => documents.map((document) => (document.id === id && document.tag === undefined ? { ...document, tag } : document)));
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

  /** Counts a read in flight for the `busy` flag, for as long as it runs; `cancelReads` ends it early. */
  private track<T>(request: Observable<T>): Observable<T> {
    this.pending.update((count) => count + 1);
    this.busy.set(true);
    return request.pipe(
      takeUntil(this.cancelled$),
      finalize(() => {
        this.pending.update((count) => count - 1);
        this.busy.set(this.pending() > 0);
      }),
      takeUntilDestroyed(this.destroyRef)
    );
  }
}
