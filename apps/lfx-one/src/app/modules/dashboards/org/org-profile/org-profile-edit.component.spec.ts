// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgCanonicalRecord } from '@lfx-one/shared/interfaces';
import { OrgProfileService } from '@services/org-profile.service';
import { MessageService } from 'primeng/api';
import { Observable, Subject, take } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgProfileEditComponent } from './org-profile-edit.component';

/**
 * LFXV2-3288 — logo upload behavior only. The form's own save/cancel/validation flow predates
 * this feature and has no existing spec coverage; backfilling it is out of scope here.
 */
describe('OrgProfileEditComponent — logo upload', () => {
  const record: OrgCanonicalRecord = {
    uid: '001Dn00000ExAmPleA',
    accountId: '001Dn00000ExAmPleA',
    name: 'Acme',
    description: null,
    website: null,
    primaryDomain: null,
    logoUrl: 'https://cdn.example.com/logo.png?v=1',
    industry: null,
    sector: null,
    numberOfEmployees: null,
    crunchBaseUrl: null,
    updatedAt: null,
    parentUid: null,
    isMember: true,
  };

  let fixture: ComponentFixture<OrgProfileEditComponent>;
  let uploadLogo$: Subject<OrgCanonicalRecord>;
  let uploadLogoMock: ReturnType<typeof vi.fn>;
  let toastAdd: ReturnType<typeof vi.spyOn>;

  function pngFile(sizeBytes = 100): File {
    return new File([new Uint8Array(sizeBytes)], 'logo.png', { type: 'image/png' });
  }

  function selectFile(file: File): void {
    const input = { files: [file], value: 'logo.png' } as unknown as HTMLInputElement;
    fixture.componentInstance['onLogoFileSelected']({ target: input } as unknown as Event);
  }

  beforeEach(async () => {
    uploadLogo$ = new Subject<OrgCanonicalRecord>();
    // `take(1)` mirrors the real OrgProfileService.uploadLogo: without it the stream never completes
    // and the component's finalize() — which clears the in-flight flag — would never run.
    uploadLogoMock = vi.fn(() => uploadLogo$.pipe(take(1)) as Observable<OrgCanonicalRecord>);

    await TestBed.configureTestingModule({
      imports: [OrgProfileEditComponent],
      providers: [provideNoopAnimations(), { provide: OrgProfileService, useValue: { uploadLogo: uploadLogoMock } }],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgProfileEditComponent);
    fixture.componentRef.setInput('record', record);
    // The component declares its own `providers: [MessageService]`, which shadows any
    // module-level override — spy on the real, component-scoped instance instead.
    toastAdd = vi.spyOn(fixture.debugElement.injector.get(MessageService), 'add');
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('seeds logoUrl from the input record on init', () => {
    expect(fixture.componentInstance['logoUrl']()).toBe(record.logoUrl);
  });

  it('rejects a disallowed file type without calling the service', async () => {
    const file = new File([new Uint8Array(10)], 'logo.gif', { type: 'image/gif' });
    selectFile(file);
    await fixture.whenStable();

    expect(uploadLogoMock).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Please choose a PNG, JPEG, or SVG image.' }));
  });

  it('accepts an SVG file and calls the service', async () => {
    const file = new File([new Uint8Array(10)], 'logo.svg', { type: 'image/svg+xml' });
    selectFile(file);
    await fixture.whenStable();

    expect(uploadLogoMock).toHaveBeenCalledWith(record.uid, file);
  });

  it('rejects an oversized file without calling the service', async () => {
    const file = pngFile(3 * 1024 * 1024);
    selectFile(file);
    await fixture.whenStable();

    expect(uploadLogoMock).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Logo must be 2MB or smaller.' }));
  });

  it('clears the file input value so re-selecting the same file still fires change', () => {
    const input = { files: [pngFile()], value: 'logo.png' } as unknown as HTMLInputElement;
    fixture.componentInstance['onLogoFileSelected']({ target: input } as unknown as Event);

    expect(input.value).toBe('');
  });

  /**
   * PR #1583 review — the input's `[disabled]="busy()"` stops real users, but a change event queued
   * from a picker opened before Save (non-modal on some platforms) or a synthetic dispatch would
   * otherwise start a second concurrent upload, whose loser surfaces as a 409 the user cannot clear.
   * Keeps all three mutation entry points guarded identically.
   */
  it('ignores a file selected while another mutation is already in flight', async () => {
    selectFile(pngFile());
    await fixture.whenStable();
    expect(uploadLogoMock).toHaveBeenCalledTimes(1);

    selectFile(pngFile());
    await fixture.whenStable();
    expect(uploadLogoMock).toHaveBeenCalledTimes(1);

    uploadLogo$.next({ ...record, logoUrl: 'https://cdn.example.com/logo.png?v=2' });
    await fixture.whenStable();

    selectFile(pngFile());
    await fixture.whenStable();
    expect(uploadLogoMock).toHaveBeenCalledTimes(2);
  });

  it('uploads a valid file, updates logoUrl, and emits logoUpdated on success', async () => {
    const emitted: OrgCanonicalRecord[] = [];
    fixture.componentInstance.logoUpdated.subscribe((updated) => emitted.push(updated));

    selectFile(pngFile());
    await fixture.whenStable();

    expect(uploadLogoMock).toHaveBeenCalledWith(record.uid, expect.any(File));
    expect(fixture.componentInstance['logoUploading']()).toBe(true);

    const updated = { ...record, logoUrl: 'https://cdn.example.com/logo.png?v=2' };
    uploadLogo$.next(updated);
    await fixture.whenStable();

    expect(fixture.componentInstance['logoUploading']()).toBe(false);
    expect(fixture.componentInstance['logoUrl']()).toBe(updated.logoUrl);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    expect(emitted).toEqual([updated]);
  });

  /**
   * PR #1583 — in-flight upload must be announced, not just spun. Before this, the overlay was a
   * bare div with a decorative <i> and no text, so screen-reader users got silence for the whole
   * upload. Pins the role="status" region, the sr-only copy, and the button's loading label so a
   * future restyle of the overlay can't quietly drop the announcement again.
   */
  it('announces the in-flight upload to assistive tech and swaps the button into a loading label', async () => {
    selectFile(pngFile());
    await fixture.whenStable();
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const status = root.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('Uploading logo');
    // The live region must sit outside the dropzone: an element with role="button" flattens its
    // descendants in the accessibility tree, so a nested region is not reliably announced.
    expect(root.querySelector('[data-testid="org-profile-edit-logo-dropzone"] [role="status"]')).toBeNull();
    // The spinner glyph carries no meaning of its own — it must not be read out alongside the copy.
    expect(root.querySelector('[data-testid="org-profile-edit-logo-dropzone"] i')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="org-profile-edit-upload-logo-button"]')?.textContent).toContain('Uploading');

    uploadLogo$.next({ ...record, logoUrl: 'https://cdn.example.com/logo.png?v=2' });
    await fixture.whenStable();
    fixture.detectChanges();

    // The region itself persists — a live region has to be in the DOM before its content changes to
    // be announced reliably — so it is the text that clears, and the next upload refills it.
    expect(root.querySelector('[role="status"]')).not.toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
    expect(root.querySelector('[data-testid="org-profile-edit-upload-logo-button"]')?.textContent).toContain('Upload Logo');
  });

  /**
   * PR #1583 review — the dropzone advertises role="button" and takes focus, but `triggerLogoUpload`
   * refuses while `busy()`. Without aria-disabled a keyboard or screen-reader user activates it and
   * gets silence. aria-disabled rather than the disabled property so the element keeps its place in
   * the tab order (same reasoning as org-meetings-time-range).
   */
  it('marks the dropzone aria-disabled only while a mutation is in flight', async () => {
    fixture.detectChanges();
    const dropzone = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="org-profile-edit-logo-dropzone"]');

    expect(dropzone?.getAttribute('role')).toBe('button');
    expect(dropzone?.getAttribute('aria-disabled')).toBe('false');

    selectFile(pngFile());
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dropzone?.getAttribute('aria-disabled')).toBe('true');

    uploadLogo$.next({ ...record, logoUrl: 'https://cdn.example.com/logo.png?v=2' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(dropzone?.getAttribute('aria-disabled')).toBe('false');
  });

  it('shows a permission-denied toast on a 403 and does not update logoUrl', async () => {
    selectFile(pngFile());
    await fixture.whenStable();

    uploadLogo$.error(new HttpErrorResponse({ status: 403 }));
    await fixture.whenStable();

    expect(fixture.componentInstance['logoUploading']()).toBe(false);
    expect(fixture.componentInstance['logoUrl']()).toBe(record.logoUrl);
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', summary: 'Permission denied', detail: 'You no longer have permission to edit this organization.' })
    );
  });

  it('shows a generic upload-failed toast on any other error', async () => {
    selectFile(pngFile());
    await fixture.whenStable();

    uploadLogo$.error(new HttpErrorResponse({ status: 502 }));
    await fixture.whenStable();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Upload failed' }));
  });

  it('warns (non-blocking) when the image is smaller than the minimum dimension, but still uploads', async () => {
    const bitmap = { width: 64, height: 64, close: vi.fn() };
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    selectFile(pngFile());
    await fixture.whenStable();

    expect(uploadLogoMock).toHaveBeenCalledWith(record.uid, expect.any(File));
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Small image' }));
  });

  it('warns (non-blocking) when the image is larger than the maximum dimension, but still uploads', async () => {
    const bitmap = { width: 2048, height: 1024, close: vi.fn() };
    const createImageBitmapMock = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    selectFile(pngFile());
    await fixture.whenStable();

    expect(uploadLogoMock).toHaveBeenCalledWith(record.uid, expect.any(File));
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Large image' }));
  });

  it('does not warn or attempt a dimension read for an SVG file', async () => {
    const createImageBitmapMock = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const file = new File([new Uint8Array(10)], 'logo.svg', { type: 'image/svg+xml' });
    selectFile(file);
    await fixture.whenStable();

    expect(createImageBitmapMock).not.toHaveBeenCalled();
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
  });

  it('does not block the upload when the dimension read fails', async () => {
    const createImageBitmapMock = vi.fn().mockRejectedValue(new Error('decode failed'));
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    selectFile(pngFile());
    await fixture.whenStable();

    expect(uploadLogoMock).toHaveBeenCalledWith(record.uid, expect.any(File));
  });

  it('ignores a drop while an upload is already in flight', async () => {
    selectFile(pngFile());
    await fixture.whenStable();
    uploadLogoMock.mockClear();

    const file = pngFile();
    const dataTransfer = { files: [file] } as unknown as DataTransfer;
    fixture.componentInstance['onLogoDrop']({ preventDefault: vi.fn(), dataTransfer } as unknown as DragEvent);
    await fixture.whenStable();

    expect(uploadLogoMock).not.toHaveBeenCalled();
  });

  it('blocks Cancel while a logo upload is in flight, so an in-flight upload is not orphaned by exiting edit mode', async () => {
    const cancelled: void[] = [];
    fixture.componentInstance.cancelled.subscribe(() => cancelled.push(undefined));

    selectFile(pngFile());
    await fixture.whenStable();
    expect(fixture.componentInstance['logoUploading']()).toBe(true);

    fixture.componentInstance['onCancel']();
    expect(cancelled).toEqual([]);

    uploadLogo$.next({ ...record, logoUrl: 'https://cdn.example.com/logo.png?v=2' });
    await fixture.whenStable();

    fixture.componentInstance['onCancel']();
    expect(cancelled).toEqual([undefined]);
  });

  it('renders the Upload Logo button, the hidden file input and the logo image', () => {
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('[data-testid="org-profile-edit-upload-logo-button"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="org-profile-edit-logo-input"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="org-profile-edit-logo-image"]')).not.toBeNull();
  });

  it('does not reopen the file picker while an upload is already in flight', async () => {
    fixture.detectChanges();
    const clickSpy = vi.spyOn(fixture.componentInstance['logoInput']()!.nativeElement, 'click');

    fixture.componentInstance['onLogoFileSelected']({
      target: { files: [pngFile()], value: 'logo.png' } as unknown as HTMLInputElement,
    } as unknown as Event);
    await fixture.whenStable();
    clickSpy.mockClear();

    // busy() is true while uploadLogo is pending, so the trigger must be inert.
    fixture.componentInstance['triggerLogoUpload']();
    expect(clickSpy).not.toHaveBeenCalled();

    uploadLogo$.next({ ...record, logoUrl: 'https://cdn.example.com/logo.png?v=3' });
    await fixture.whenStable();

    fixture.componentInstance['triggerLogoUpload']();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [413, 'Logo too large', 'Logo must be 2MB or smaller.'],
    [403, 'Permission denied', 'You no longer have permission to edit this organization.'],
  ])('maps status %i to non-retryable copy', async (status, summary, detail) => {
    fixture.detectChanges();
    fixture.componentInstance['onLogoFileSelected']({
      target: { files: [pngFile()], value: 'logo.png' } as unknown as HTMLInputElement,
    } as unknown as Event);
    await fixture.whenStable();

    uploadLogo$.error(new HttpErrorResponse({ status }));
    await fixture.whenStable();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary, detail }));
  });

  // The BFF serialises errors as `{ error, code, ... }` (BaseApiError.toResponse) and
  // ServiceValidationError adds `errors[]` — there is no top-level `message` key, so these
  // fixtures mirror the real contract rather than a convenient one.
  it.each([
    ['top-level error string', { error: 'SVG upload cannot be processed: unsupported CSS selector "rect"', code: 'VALIDATION_ERROR' }],
    [
      'field-level validation detail',
      {
        error: 'Validation failed for body',
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'body', message: 'SVG upload cannot be processed: unsupported CSS property "d"' }],
      },
    ],
    ['plain string body', 'SVG upload cannot be processed: unterminated rule'],
  ])('surfaces the upstream reason (%s) when the sanitizer rejects an SVG', async (_label, body) => {
    fixture.detectChanges();
    fixture.componentInstance['onLogoFileSelected']({
      target: { files: [pngFile()], value: 'logo.png' } as unknown as HTMLInputElement,
    } as unknown as Event);
    await fixture.whenStable();

    uploadLogo$.error(new HttpErrorResponse({ status: 400, error: body }));
    await fixture.whenStable();

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Logo rejected', detail: expect.stringContaining('SVG upload cannot be processed') })
    );
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('Please try again') }));
  });

  it('falls back to actionable guidance when a rejection carries no usable reason', async () => {
    fixture.detectChanges();
    fixture.componentInstance['onLogoFileSelected']({
      target: { files: [pngFile()], value: 'logo.png' } as unknown as HTMLInputElement,
    } as unknown as Event);
    await fixture.whenStable();

    // Angular synthesizes a non-empty `error.message` ("Http failure response for …"), which must
    // not reach the toast — the user needs guidance, not an HTTP debugging string.
    uploadLogo$.error(new HttpErrorResponse({ status: 415 }));
    await fixture.whenStable();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Logo rejected', detail: 'This image could not be used. Try a different file.' }));
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('Http failure response') }));
  });

  // The BFF gives these their own actionable copy, so routing them through the rejection branch
  // would print a summary that contradicts the detail and send the user off to swap a file that
  // was never at fault (org-identity.controller.ts).
  it.each([
    [409, 'This organization was updated elsewhere. Refresh the page and try again.'],
    [404, 'Organization not found'],
  ])('does not label status %i as a rejected logo', async (status, serverMessage) => {
    fixture.detectChanges();
    fixture.componentInstance['onLogoFileSelected']({
      target: { files: [pngFile()], value: 'logo.png' } as unknown as HTMLInputElement,
    } as unknown as Event);
    await fixture.whenStable();

    uploadLogo$.error(new HttpErrorResponse({ status, error: { error: serverMessage } }));
    await fixture.whenStable();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Upload failed', detail: serverMessage }));
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Logo rejected' }));
  });

  it.each([[408], [429], [0]])('keeps the retry prompt for transient status %i', async (status) => {
    fixture.detectChanges();
    fixture.componentInstance['onLogoFileSelected']({
      target: { files: [pngFile()], value: 'logo.png' } as unknown as HTMLInputElement,
    } as unknown as Event);
    await fixture.whenStable();

    // 408 and 429 are 4xx but retryable — this server mints 408 for its own upstream abort, so
    // labelling either "Logo rejected" would tell the user a fine file is permanently broken.
    uploadLogo$.error(new HttpErrorResponse({ status }));
    await fixture.whenStable();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Upload failed', detail: 'Unable to upload logo. Please try again.' }));
  });

  it('still prompts a retry for a server-side failure', async () => {
    fixture.detectChanges();
    fixture.componentInstance['onLogoFileSelected']({
      target: { files: [pngFile()], value: 'logo.png' } as unknown as HTMLInputElement,
    } as unknown as Event);
    await fixture.whenStable();

    uploadLogo$.error(new HttpErrorResponse({ status: 502 }));
    await fixture.whenStable();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Upload failed', detail: 'Unable to upload logo. Please try again.' }));
  });
});
