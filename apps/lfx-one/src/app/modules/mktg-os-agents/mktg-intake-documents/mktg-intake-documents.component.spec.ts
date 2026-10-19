// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FOUNDATION_MESSAGE_INTAKE } from '@lfx-one/shared/constants';
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
    component['onFilesSelected'](fileEvent(new File(['x'], 'deck.pptx')));
    expect(readFile).not.toHaveBeenCalled();
    expect(component['errorText']()).toContain('deck.pptx');

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

  it('removes a document', async () => {
    component.documents.set([{ id: 'file-1', kind: 'file', title: 'notes.md', text: 'x', read: true, words: 1, truncated: false }]);
    await fixture.whenStable();

    component['onRemove']('file-1');

    expect(component.documents()).toEqual([]);
  });
});
