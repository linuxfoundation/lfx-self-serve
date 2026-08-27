// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SAVED_VIEW_NAME_MAX_LENGTH } from '@lfx-one/shared/constants';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaveViewDialogComponent } from './save-view-dialog.component';

describe('SaveViewDialogComponent', () => {
  let fixture: ComponentFixture<SaveViewDialogComponent>;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  function nameInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('[data-testid="save-view-dialog-name-input"]');
  }

  function saveButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="save-view-dialog-save"] button');
  }

  async function typeName(value: string): Promise<void> {
    const input = nameInput();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function create(existingNames: string[] = []): void {
    dialogRef = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [SaveViewDialogComponent],
      providers: [
        provideRouter([]),
        { provide: DynamicDialogRef, useValue: dialogRef },
        { provide: DynamicDialogConfig, useValue: { data: { existingNames } } },
      ],
    });
    fixture = TestBed.createComponent(SaveViewDialogComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  beforeEach(() => create(['Crisis alerts']));

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
  });

  it('autofocuses the name input on open', async () => {
    await fixture.whenStable();
    expect(document.activeElement).toBe(nameInput());
  });

  it('starts invalid: Save is disabled until a non-blank name is typed', async () => {
    expect(saveButton().disabled).toBe(true);

    await typeName('   ');
    expect(saveButton().disabled).toBe(true);

    await typeName('Kubernetes');
    expect(saveButton().disabled).toBe(false);
  });

  it('flags a duplicate name case-insensitively and wires aria-invalid/describedby', async () => {
    await typeName('crisis ALERTS');

    expect(saveButton().disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="save-view-dialog-duplicate-error"]')?.textContent).toContain(
      'A view named "crisis ALERTS" already exists. Try a different name.'
    );
    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    expect(nameInput().getAttribute('aria-describedby')).toBe('view-name-error');
  });

  it('shows the live character counter while the name is unique', async () => {
    const counter = (): HTMLElement => fixture.nativeElement.querySelector('[data-testid="save-view-dialog-counter"]');
    expect(counter().textContent?.trim()).toBe(`0/${SAVED_VIEW_NAME_MAX_LENGTH}`);

    await typeName('AB');
    expect(counter().textContent?.trim()).toBe(`2/${SAVED_VIEW_NAME_MAX_LENGTH}`);
  });

  it('caps the input at the shared max length', () => {
    expect(nameInput().maxLength).toBe(SAVED_VIEW_NAME_MAX_LENGTH);
  });

  it('Enter closes with the trimmed name', async () => {
    await typeName('  Kubernetes  ');

    nameInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();

    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(dialogRef.close).toHaveBeenCalledWith('Kubernetes');
  });

  it('Enter is a no-op while the name is invalid', async () => {
    await typeName('crisis alerts');

    nameInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('Save closes with the trimmed name', async () => {
    await typeName('  My View ');

    saveButton().click();
    await fixture.whenStable();

    expect(dialogRef.close).toHaveBeenCalledWith('My View');
  });

  it('Cancel closes without a value', async () => {
    const cancelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="save-view-dialog-cancel"] button');
    cancelButton.click();
    await fixture.whenStable();

    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(dialogRef.close.mock.calls[0]).toHaveLength(0);
  });
});
