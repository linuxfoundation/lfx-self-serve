// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { member360DocumentType, member360Revision, MEMBER_360_STORED_DOCUMENT } from '../../../../../e2e/fixtures/mock-data/member-360.mock';
import { SYNTHETIC_ORG_NAME } from '../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { provideRouter, Router } from '@angular/router';
import { Member360Service } from '@services/member-360.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Member360RunComponent } from './member-360-run.component';

describe('Member360RunComponent', () => {
  let fixture: ComponentFixture<Member360RunComponent>;
  const context = {
    activeContext: signal({ uid: 'sample-project', name: 'Sample Foundation', slug: 'sample-foundation' }),
    activeContextUid: signal('sample-project'),
    activeProject: signal({ writer: true }),
    canWrite: signal(true),
  };
  const documents = {
    listDocuments: vi.fn<MktgDocumentStoreService['listDocuments']>(() => of({ project: 'sample-project', groups: [] })),
    getRevision: vi.fn(() => of(member360Revision())),
  };
  const run = {
    generate: vi.fn(() => of({ sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567' })),
    parseTracker: vi.fn(() => of({ filename: 'repeat.csv', rows: [{ company: SYNTHETIC_ORG_NAME }] })),
  };
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(Member360RunComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function button(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="member-360-run"] button');
  }
  beforeEach(async () => {
    context.canWrite.set(true);
    documents.listDocuments.mockReturnValue(of({ project: 'sample-project', groups: [] }));
    run.generate.mockReturnValue(of({ sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567' }));
    run.generate.mockClear();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Member360Service, useValue: run },
        { provide: MktgDocumentStoreService, useValue: documents },
        { provide: ProjectContextService, useValue: context },
        { provide: UserService, useValue: { user: signal({ sub: 'synthetic-subject' }) } },
      ],
    }).compileComponents();
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('fixes the project and defaults to a twelve-month window with empty run history', async () => {
    await render();
    const project = fixture.nativeElement.querySelector('[data-testid="member-360-project"]');
    expect(project.textContent).toContain('Sample Foundation');
    const hint = project.querySelector('[data-testid="member-360-project-hint"]');
    expect(hint?.previousElementSibling?.textContent).toBe('Sample Foundation');
    expect(hint?.classList.contains('text-[13px]')).toBe(true);
    expect(project.classList.contains('gap-[10px]')).toBe(true);
    const trackersLabel = fixture.nativeElement.querySelector('[data-testid="member-360-trackers-label"]');
    expect(trackersLabel.classList.contains('flex')).toBe(false);
    const trackersHint = trackersLabel.querySelector('[data-testid="member-360-trackers-hint"]');
    expect(trackersHint?.previousElementSibling?.textContent).toBe('Trackers');
    expect(trackersHint?.previousSibling?.nodeType).toBe(Node.TEXT_NODE);
    expect(trackersHint?.previousSibling?.textContent).toBe(' ');
    expect(trackersHint?.classList.contains('font-normal')).toBe(true);
    expect(trackersHint?.classList.contains('text-gray-500')).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-upload-types"]').textContent).toBe('XLSX or CSV');
    expect(fixture.componentInstance.form.controls.window.value).toBe('12');
    expect(fixture.nativeElement.textContent).toContain('No Member 360 runs yet.');
    expect(button().disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('main')).toBeNull();
    const breadcrumb = fixture.nativeElement.querySelector('[data-testid="member-360-breadcrumb"]');
    expect(breadcrumb.textContent).toMatch(/Sample Foundation kit.*Member & sponsor kit.*Member 360/s);
    expect(breadcrumb.querySelectorAll('li:not([aria-hidden])')).toHaveLength(3);
    expect(breadcrumb.querySelector('a')?.getAttribute('data-testid')).toBe('member-360-back');
    const intake = fixture.nativeElement.querySelector('[data-testid="member-360-intake"]');
    expect(intake.querySelector('[data-testid="member-360-run"]')).not.toBeNull();
    expect(intake.textContent).toContain('Sources this run will use');
  });
  it('names the comparison run and displays its real stored date', async () => {
    documents.listDocuments.mockReturnValue(
      of({ project: 'sample-project', groups: [{ type: member360DocumentType(), documents: [MEMBER_360_STORED_DOCUMENT] }] })
    );
    await render();
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-last-run"]').textContent).toContain('Last run Q3 2026, 1 Oct');
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-compare"]').textContent).toContain('Previous run: Q3 2026 (1 Oct)');
  });
  it('keeps duplicate filenames distinct and preserves focus after removing the middle file', async () => {
    await render();
    const chooser = fixture.nativeElement.querySelector('lfx-file-upload');
    await fixture.componentInstance['upload']([1, 2, 3].map(() => new File([`company\n${SYNTHETIC_ORG_NAME}`], 'repeat.csv')));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('lfx-file-upload')).toBe(chooser);
    expect(document.activeElement).toBe(chooser.querySelector('button'));
    const uploads = fixture.componentInstance.form.controls.trackers.value;
    expect(new Set(uploads.map((upload) => upload.id)).size).toBe(3);
    const retained: HTMLButtonElement = fixture.nativeElement.querySelector(`[data-testid="member-360-remove-${uploads[2].id}"] button`);
    retained.focus();
    fixture.componentInstance['remove'](uploads[1].id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(`[data-testid="member-360-remove-${uploads[2].id}"] button`)).toBe(retained);
    expect(document.activeElement).toBe(retained);
  });
  it('explains an unavailable comparison instead of a generic server error', async () => {
    run.generate.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEMBER_360_COMPARISON_UNAVAILABLE' } })));
    await render();
    button().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Turn off comparison or retry.');
  });
  it('sends raw tracker bytes and project scope for entitled server parsing', () => {
    TestBed.overrideProvider(Member360Service, { useFactory: () => new Member360Service() });
    const api = TestBed.inject(Member360Service),
      http = TestBed.inject(HttpTestingController);
    const file = new File([`company\n${SYNTHETIC_ORG_NAME}`], 'tracker.csv', { type: 'text/csv' });
    const tracker = { filename: file.name, rows: [{ company: SYNTHETIC_ORG_NAME }] };
    let received: unknown;
    api.parseTracker('sample-project', file).subscribe((value) => {
      received = value;
    });
    const request = http.expectOne('/api/mktg-agents/member-360/tracker?project=sample-project');
    expect(request.request.headers.get('X-File-Name')).toBe('tracker.csv');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(request.request.body).toBe(file);
    request.flush(tracker);
    expect(received).toEqual(tracker);
  });
  it('rejects a PDF selected through the chooser before any upload', async () => {
    await render();
    run.parseTracker.mockClear();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="member-360-upload"] input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['synthetic pdf'], 'tracker.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(run.parseTracker).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-error"]').textContent).toContain('Only .xlsx or .csv trackers can be uploaded.');
    expect(fixture.componentInstance.form.controls.trackers.value).toEqual([]);
    expect(button().disabled).toBe(false);
  });
  it.each([`${'x'.repeat(201)}.csv`, 'folder/tracker.csv'])('explains an invalid filename separately from its accepted extension: %s', async (filename) => {
    await render();
    run.parseTracker.mockClear();
    await fixture.componentInstance['upload']([new File(['company'], filename)]);
    fixture.detectChanges();
    expect(run.parseTracker).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-error"]').textContent).toContain('Use a shorter file name without slashes.');
  });
  it('rejects a mixed batch before sending even the valid tracker', async () => {
    await render();
    run.parseTracker.mockClear();
    await fixture.componentInstance['upload']([new File(['company'], 'tracker.csv'), new File(['pdf'], 'tracker.pdf')]);
    expect(run.parseTracker).not.toHaveBeenCalled();
    expect(fixture.componentInstance.form.controls.trackers.value).toEqual([]);
  });
  it('shows the specific tracker validation reason from the BFF', async () => {
    run.parseTracker.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              error: 'Validation failed for tracker',
              errors: [{ field: 'tracker', message: 'Upload one tracker sheet per file.' }],
            },
          })
      )
    );
    await render();
    await fixture.componentInstance['upload']([new File(['csv'], 'tracker.csv')]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-error"]').textContent).toContain('Upload one tracker sheet per file.');
  });
  it('does not offer a form to non-writers', async () => {
    context.canWrite.set(false);
    await render();
    expect(button()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('You need write access');
  });
  it('submits only the project identifier and form choices, then opens its document', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    button().click();
    await fixture.whenStable();
    expect(run.generate).toHaveBeenCalledWith({ project: 'sample-project', window: '12', compare: true, trackers: [] });
    expect(navigate).toHaveBeenCalledWith(
      ['../documents/member-360', 'run-0123456789abcdef01234567'],
      expect.objectContaining({ queryParams: { revision: null }, queryParamsHandling: 'merge' })
    );
  });
  it('keeps Generate alive after navigation and retains the pending capability without navigating again', async () => {
    TestBed.overrideProvider(Member360Service, { useFactory: () => new Member360Service() });
    const api = TestBed.inject(Member360Service);
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    button().click();
    const request = http.expectOne('/api/mktg-agents/member-360/generate');
    fixture.destroy();
    expect(request.cancelled).toBe(false);
    request.flush({ sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567' });
    expect(api.isPending('sample-project', 'run-0123456789abcdef01234567')).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    sessionStorage.clear();
  });
  it('reports a submission failure and allows retry', async () => {
    run.generate.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await render();
    button().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('could not be started');
    expect(button().disabled).toBe(false);
  });
  it('does not silently discard a failed history lookup when comparing', async () => {
    documents.listDocuments.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await render();
    expect(button().disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Run history could not be loaded');
    documents.listDocuments.mockReturnValue(of({ project: 'sample-project', groups: [] }));
    const retry = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((element) =>
      element.textContent?.includes('Retry history')
    )!;
    retry.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
  });
});
