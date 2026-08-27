// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ORG_LENS_PRIVATE_RELEASE_FLAG } from '@lfx-one/shared/constants';
import type { OrgCanonicalRecord } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
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
      providers: [
        provideNoopAnimations(),
        { provide: OrgProfileService, useValue: { uploadLogo: uploadLogoMock } },
        // PR #1583 — gate the Upload Logo affordance on `org_lens_private_release`. Default the
        // flag to `true` in this suite because every existing test exercises the upload path; the
        // dedicated "flag disabled" describe below re-configures TestBed with the same mock
        // returning `false` for the gating test.
        {
          provide: FeatureFlagService,
          useValue: { getBooleanFlag: vi.fn((key: string) => signal(key === ORG_LENS_PRIVATE_RELEASE_FLAG ? true : false)) },
        },
      ],
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
    // The spinner glyph carries no meaning of its own — it must not be read out alongside the copy.
    expect(status?.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('[data-testid="org-profile-edit-upload-logo-button"]')?.textContent).toContain('Uploading');

    uploadLogo$.next({ ...record, logoUrl: 'https://cdn.example.com/logo.png?v=2' });
    await fixture.whenStable();
    fixture.detectChanges();

    // Region is removed once settled, so the next upload re-inserts it and is announced afresh.
    expect(root.querySelector('[role="status"]')).toBeNull();
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

  /**
   * PR #1583 — Company Logo Upload is gated on the per-feature wrapper `isOrgLensUploadLogoEnabled`,
   * which today reads `org_lens_private_release` but is expected to graduate to its own key later.
   * Assertions target the wrapper (the API surface the template and handlers consume), not the raw
   * private flag reader — that way this suite still passes when the underlying key gets swapped.
   * When the wrapper is on the Upload Logo button and hidden file input render and the dropzone
   * accepts drops; when it's off the whole affordance collapses to a static preview so a general
   * Org Lens viewer only sees the logo, not the write path.
   */
  describe('isOrgLensUploadLogoEnabled wrapper gating', () => {
    it('renders the Upload Logo button and hidden file input when the wrapper is enabled (default suite mock)', () => {
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;

      expect(fixture.componentInstance['isOrgLensUploadLogoEnabled']()).toBe(true);
      expect(root.querySelector('[data-testid="org-profile-edit-upload-logo-button"]')).not.toBeNull();
      expect(root.querySelector('[data-testid="org-profile-edit-logo-input"]')).not.toBeNull();
    });

    it('hides the Upload Logo button and file input and neutralizes drop-handling when the wrapper is disabled', async () => {
      // Fresh TestBed with the SAME mock shape but returning `false` for the gating flag — mirrors
      // the pattern in weekly-brief-card.component.spec.ts's flag-off block.
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [OrgProfileEditComponent],
        providers: [
          provideNoopAnimations(),
          { provide: OrgProfileService, useValue: { uploadLogo: uploadLogoMock } },
          {
            provide: FeatureFlagService,
            useValue: { getBooleanFlag: vi.fn((key: string) => signal(key === ORG_LENS_PRIVATE_RELEASE_FLAG ? false : false)) },
          },
        ],
      }).compileComponents();

      const disabledFixture = TestBed.createComponent(OrgProfileEditComponent);
      disabledFixture.componentRef.setInput('record', record);
      await disabledFixture.whenStable();
      disabledFixture.detectChanges();
      const root: HTMLElement = disabledFixture.nativeElement;

      expect(disabledFixture.componentInstance['isOrgLensUploadLogoEnabled']()).toBe(false);
      expect(root.querySelector('[data-testid="org-profile-edit-upload-logo-button"]')).toBeNull();
      expect(root.querySelector('[data-testid="org-profile-edit-logo-input"]')).toBeNull();

      // The static-preview shell still renders the logo image itself so read-only viewers keep the
      // context; only the write affordance is stripped.
      expect(root.querySelector('[data-testid="org-profile-edit-logo-image"]')).not.toBeNull();

      // Defense-in-depth: even if a synthetic drop / click / file-select reaches the handlers, the
      // component-level gate must not call through to the service.
      uploadLogoMock.mockClear();
      const file = pngFile();
      disabledFixture.componentInstance['onLogoDrop']({
        preventDefault: vi.fn(),
        dataTransfer: { files: [file] } as unknown as DataTransfer,
      } as unknown as DragEvent);
      disabledFixture.componentInstance['triggerLogoUpload']();
      const input = { files: [file], value: 'logo.png' } as unknown as HTMLInputElement;
      disabledFixture.componentInstance['onLogoFileSelected']({ target: input } as unknown as Event);
      await disabledFixture.whenStable();

      expect(uploadLogoMock).not.toHaveBeenCalled();
    });
  });
});
