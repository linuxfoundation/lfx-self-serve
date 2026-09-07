// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { CharterDialogComponent } from './charter-dialog.component';

/**
 * Covers the URL validator mirroring the backend's charterURLPattern/MaxLength(2048) exactly
 * (PR #2218 review fix): a bare-host URL with no dot is contract-valid, whitespace and
 * over-length values are not — plus the never-set no-op guard living in committee-view is
 * exercised separately, this file only covers what the dialog itself validates.
 */
describe('CharterDialogComponent', () => {
  let fixture: ComponentFixture<CharterDialogComponent>;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  function urlInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('[data-test="committee-view-charter-input"]');
  }

  function saveButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="charter-dialog-save"] button');
  }

  function cancelButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="charter-dialog-cancel"] button');
  }

  async function typeUrl(value: string): Promise<void> {
    const input = urlInput();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function create(url = ''): void {
    dialogRef = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [CharterDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: dialogRef },
        { provide: DynamicDialogConfig, useValue: { data: { url } } },
      ],
    });
    fixture = TestBed.createComponent(CharterDialogComponent);
    fixture.detectChanges();
  }

  it('associates the visible label with the input by id, for accessible-name discovery', () => {
    create();
    const label: HTMLLabelElement = fixture.nativeElement.querySelector('label');
    const id = urlInput().id;
    expect(label.getAttribute('for')).toBe(id);
    // A static `id=` on `lfx-input-text` lands on both the host and the native input it renders,
    // so `label[for]` would resolve to the non-labelable host in a real browser -- guard against
    // that regression by asserting the id is unique in the rendered DOM.
    expect(fixture.nativeElement.querySelectorAll(`#${id}`).length).toBe(1);
  });

  it('accepts a contract-valid bare-host URL with no dot (matches the backend pattern, unlike the general website field)', async () => {
    create();
    await typeUrl('http://committee/charter');
    expect(fixture.nativeElement.querySelector('[data-testid="committee-charter-url-error"]')).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it('rejects a URL containing whitespace', async () => {
    create();
    await typeUrl('http://exa mple.com/charter');
    expect(fixture.nativeElement.querySelector('[data-testid="committee-charter-url-error"]')?.textContent).toContain('Enter a valid http(s) URL');
    expect(saveButton().disabled).toBe(true);
  });

  it('rejects a URL over the 2,048-character upstream limit, with a length-specific message', async () => {
    create();
    await typeUrl('https://example.org/' + 'a'.repeat(2048));
    expect(fixture.nativeElement.querySelector('[data-testid="committee-charter-url-error"]')?.textContent).toContain('too long');
    expect(saveButton().disabled).toBe(true);
  });

  it('treats a blank value as valid regardless of the pattern (the removal signal)', async () => {
    create('https://example.org/charter.pdf');
    await typeUrl('');
    expect(fixture.nativeElement.querySelector('[data-testid="committee-charter-url-error"]')).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it('Save closes with the typed URL', async () => {
    create();
    await typeUrl('https://example.org/charter.pdf');
    saveButton().click();
    expect(dialogRef.close).toHaveBeenCalledWith('https://example.org/charter.pdf');
  });

  it('Cancel closes without a value', () => {
    create();
    cancelButton().click();
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(dialogRef.close.mock.calls[0]).toHaveLength(0);
  });
});
