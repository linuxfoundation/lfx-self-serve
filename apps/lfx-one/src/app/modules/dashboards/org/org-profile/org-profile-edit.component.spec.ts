// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgCanonicalRecord } from '@lfx-one/shared/interfaces';
import { OrgProfileService } from '@services/org-profile.service';
import { MessageService } from 'primeng/api';
import { Observable, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    uploadLogoMock = vi.fn(() => uploadLogo$.asObservable() as Observable<OrgCanonicalRecord>);

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

  it('seeds logoUrl from the input record on init', () => {
    expect(fixture.componentInstance['logoUrl']()).toBe(record.logoUrl);
  });

  it('rejects a disallowed file type without calling the service', async () => {
    const file = new File([new Uint8Array(10)], 'logo.svg', { type: 'image/svg+xml' });
    selectFile(file);
    await fixture.whenStable();

    expect(uploadLogoMock).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Please choose a PNG or JPEG image.' }));
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
});
