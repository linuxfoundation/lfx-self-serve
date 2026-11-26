// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LinkedInDocumentEditorComponent } from './linkedin-document-editor.component';

/** Wiring only: the document rules are `campaign-linkedin-document-form.utils.ts`'s, tested there. */
describe('LinkedInDocumentEditorComponent', () => {
  let f: ComponentFixture<LinkedInDocumentEditorComponent>;
  const c = (): Record<string, any> => f.componentInstance as unknown as Record<string, any>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LinkedInDocumentEditorComponent] }).compileComponents();
    f = TestBed.createComponent(LinkedInDocumentEditorComponent);
    f.componentRef.setInput('document', { assetId: '', assetBriefId: '', title: '', introText: '' });
    f.componentRef.setInput('briefId', 'b-1');
  });

  it('records the brief a PDF is picked for, and clears it with the "No PDF" option', () => {
    c()['onPdfPick']('pdf-1');
    expect(f.componentInstance.document()).toMatchObject({ assetId: 'pdf-1', assetBriefId: 'b-1' });
    c()['onPdfPick']('');
    expect(f.componentInstance.document()).toMatchObject({ assetId: '', assetBriefId: '' });
  });

  it('shows the gated warning and the upload only while given', () => {
    f.detectChanges();
    const query = (testId: string): HTMLElement | null => f.nativeElement.querySelector(`[data-testid="${testId}"]`);
    expect(query('linkedin-document-editor-gated-warning')).toBeNull();
    expect(query('linkedin-document-editor-upload')).toBeNull();
    f.componentRef.setInput('gatedWarning', 'A gated document needs a free preview page.');
    f.componentRef.setInput('uploadAvailable', true);
    f.detectChanges();
    expect(query('linkedin-document-editor-gated-warning')?.textContent).toContain('free preview page');
    expect(query('linkedin-document-editor-upload')).not.toBeNull();
  });
});
