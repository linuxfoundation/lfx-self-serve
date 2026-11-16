// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FOUNDATION_MESSAGE_INTAKE, MKTG_DRIVE_SHARING_HINT, MKTG_INTAKE_LINK_ADVICE } from '@lfx-one/shared/constants';
import { MktgDocumentExtractResponse, MktgIntakeDocumentsConfig } from '@lfx-one/shared/interfaces';
import { MktgIntakeDocumentsService } from '@services/mktg-intake-documents.service';
import type { FileSelectEvent } from 'primeng/fileupload';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgIntakeDocumentsComponent } from './mktg-intake-documents.component';

describe('MktgIntakeDocumentsComponent', () => {
  const config = FOUNDATION_MESSAGE_INTAKE.documents as MktgIntakeDocumentsConfig;
  let fixture: ComponentFixture<MktgIntakeDocumentsComponent>;
  let component: MktgIntakeDocumentsComponent;
  let readFile: ReturnType<typeof vi.fn>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const fileEvent = (...files: File[]): FileSelectEvent => ({ originalEvent: new Event('change'), files, currentFiles: files });

  beforeEach(async () => {
    readFile = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MktgIntakeDocumentsComponent],
      // The LFX file-upload wrapper's PrimeNG uploader injects HttpClient; the testing backend keeps every request local.
      providers: [provideNoopAnimations(), provideHttpClient(), provideHttpClientTesting(), { provide: MktgIntakeDocumentsService, useValue: { readFile } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MktgIntakeDocumentsComponent);
    fixture.componentRef.setInput('config', config);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('describes the link input with the shared LF-wide Drive sharing guidance before typing', () => {
    const input = host().querySelector<HTMLInputElement>('[data-test="mktg-intake-documents-link-input"]');
    const hint = host().querySelector('#mktg-intake-documents-link-hint');
    expect(hint?.textContent?.trim()).toBe(MKTG_DRIVE_SHARING_HINT);
    expect(input?.getAttribute('aria-describedby')).toBe(hint?.id);
  });

  it('lists an added link as given, never reading it — the agent fetches it', async () => {
    component['linkForm'].controls.url.setValue('https://docs.google.com/document/d/x/edit');

    component['onAddLink']();
    await fixture.whenStable();

    expect(component.documents()).toEqual([
      expect.objectContaining({
        kind: 'link',
        title: 'https://docs.google.com/document/d/x/edit',
        url: 'https://docs.google.com/document/d/x/edit',
        read: false,
        words: 0,
      }),
    ]);
    expect(host().textContent).toContain('the agent reads it');
    expect(component.busy()).toBe(false);
    expect(component['linkForm'].controls.url.value).toBe('');
  });

  it('warns about Drive links and duplicates across fields/slots without blocking Add link', async () => {
    const url = 'https://drive.google.com/drive/folders/synthetic';
    fixture.componentRef.setInput('earlierUrls', [url]);
    component['linkForm'].controls.url.setValue(url + '/?usp=sharing');
    await fixture.whenStable();
    expect(host().querySelector('[data-testid="mktg-intake-documents-link-warning"]')?.textContent).toContain(MKTG_INTAKE_LINK_ADVICE.duplicate);
    expect(host().textContent).toContain(MKTG_INTAKE_LINK_ADVICE.driveFolder);
    expect(host().querySelector<HTMLButtonElement>('[data-testid="mktg-intake-documents-add-link"] button')?.disabled).toBe(false);
    component['onAddLink']();
    fixture.componentRef.setInput('earlierUrls', []);
    component['linkForm'].controls.url.setValue(url);
    component['onAddLink']();
    await fixture.whenStable();
    expect(component.documents()).toHaveLength(2);
    expect(component['linkWarnings']()[component.documents()[0].id]).not.toContain('already added');
    expect(component['linkWarnings']()[component.documents()[1].id]).toContain(MKTG_INTAKE_LINK_ADVICE.duplicate);
    expect(host().querySelectorAll('[data-testid^="mktg-intake-documents-warning-"]')).toHaveLength(2);
    expect(component['linkForm'].valid).toBe(true);
  });

  it('refuses a link that is not https://', () => {
    component['linkForm'].controls.url.setValue('http://wiki.example.org/note');

    component['onAddLink']();

    expect(component.documents()).toEqual([]);
    expect(component['errorText']()).toContain('https://');
  });

  it('adds an uploaded file with the text the server read, and is busy while it reads', async () => {
    const response = new Subject<MktgDocumentExtractResponse>();
    readFile.mockReturnValue(response.asObservable());

    component['onFilesSelected'](fileEvent(new File(['# Notes'], 'notes.md')));
    expect(component.busy()).toBe(true);

    response.next({ title: 'notes.md', read: true, words: 1, truncated: false, text: '# Notes' });
    response.complete();
    await fixture.whenStable();

    expect(component.busy()).toBe(false);
    expect(component.documents()).toEqual([expect.objectContaining({ kind: 'file', title: 'notes.md', text: '# Notes', read: true })]);
  });

  it('drops a read in flight when its reads are cancelled: the file never lands, and the section is no longer busy', async () => {
    const response = new Subject<MktgDocumentExtractResponse>();
    readFile.mockReturnValue(response.asObservable());

    component['onFilesSelected'](fileEvent(new File(['# Notes'], 'notes.md')));
    expect(component.busy()).toBe(true);

    component.cancelReads();
    response.next({ title: 'notes.md', read: true, words: 1, truncated: false, text: '# Notes' });
    response.complete();
    await fixture.whenStable();

    expect(component.documents()).toEqual([]);
    expect(component.busy()).toBe(false);
    expect(component['errorText']()).toBe('');
  });

  it('refuses a file type it cannot read before uploading it, and never adds a file with no text', async () => {
    component['onFilesSelected'](fileEvent(new File(['x'], 'deck.key')));
    expect(readFile).not.toHaveBeenCalled();
    expect(component['errorText']()).toContain('deck.key');

    readFile.mockReturnValue(of<MktgDocumentExtractResponse>({ title: 'scan.pdf', read: false, words: 0, truncated: false, reason: 'No text found.' }));
    component['onFilesSelected'](fileEvent(new File(['%PDF'], 'scan.pdf')));
    await fixture.whenStable();

    expect(component.documents()).toEqual([]);
    expect(component['errorText']()).toBe('scan.pdf: No text found.');

    readFile.mockReturnValue(throwError(() => new Error('network')));
    component['onFilesSelected'](fileEvent(new File(['x'], 'brief.docx')));
    await fixture.whenStable();
    expect(component.busy()).toBe(false);
  });

  it('takes files through the LFX file-upload wrapper, limited to the readable types and disabled at the limit', async () => {
    const upload = host().querySelector('[data-testid="mktg-intake-documents-upload"]');
    const input = host().querySelector<HTMLInputElement>('input[type="file"]');

    expect(upload).not.toBeNull();
    expect(input?.accept).toBe(config.fileExtensions.join(','));
    expect(input?.multiple).toBe(true);

    component.documents.set(
      Array.from({ length: config.maxDocuments }, (_, index) => ({
        id: `file-${index}`,
        kind: 'file' as const,
        title: 'x',
        text: 'x',
        read: true,
        words: 1,
        truncated: false,
      }))
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host().querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
  });

  it('tags every document with the intake’s default kind and lets the requester change it — the tag rides the document', async () => {
    component['linkForm'].controls.url.setValue('https://press.example.org/launch');
    component['onAddLink']();
    await fixture.whenStable();

    const [added] = component.documents();
    expect(added.tag).toBe(config.defaultTag);
    expect(host().querySelector(`[data-test="mktg-intake-documents-tag-${added.id}"]`)).not.toBeNull();

    component['tagsForm'].controls[added.id].setValue('press');
    await fixture.whenStable();
    expect(component.documents()[0].tag).toBe('press');

    // The control goes with the document.
    component['onRemove'](added.id);
    await fixture.whenStable();
    expect(component['tagsForm'].controls[added.id]).toBeUndefined();
  });

  it('lists a file handed over by an intake field with that field’s tag, read like any upload; an unknown tag falls back to the default', async () => {
    readFile.mockImplementation((_config: MktgIntakeDocumentsConfig, file: File) =>
      of<MktgDocumentExtractResponse>({ title: file.name, read: true, words: 2, truncated: false, text: 'Deck text' })
    );

    component.addFiles([new File(['x'], 'board-deck.pdf')], 'deck');
    component.addFiles([new File(['x'], 'other.pdf')], 'brand');
    await fixture.whenStable();

    expect(component.documents().map((document) => [document.title, document.tag])).toEqual([
      ['board-deck.pdf', 'deck'],
      ['other.pdf', config.defaultTag],
    ]);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(component['tagsForm'].controls[component.documents()[0].id].value).toBe('deck');
  });

  it('removes a document', async () => {
    component.documents.set([{ id: 'file-1', kind: 'file', title: 'notes.md', text: 'x', read: true, words: 1, truncated: false }]);
    await fixture.whenStable();

    component['onRemove']('file-1');

    expect(component.documents()).toEqual([]);
  });
});
