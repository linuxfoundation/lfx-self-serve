// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GoogleCreativeImageSlotView } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { GoogleCreativeImageLibraryComponent } from './google-creative-image-library.component';

describe('GoogleCreativeImageLibraryComponent', () => {
  const KEY = 'displayCreative.logoImages';
  let fixture: ComponentFixture<GoogleCreativeImageLibraryComponent>;

  const view = (patch: Partial<GoogleCreativeImageSlotView> = {}): GoogleCreativeImageSlotView => ({
    key: KEY,
    label: 'Logo images (4:1)',
    requirement: '4:1 (within 1%), at least 512x128 px',
    held: [],
    options: [{ label: '1200x300 PNG · 22222222', value: 'asset-2' }],
    optionsNote: '',
    canAdd: true,
    uploading: false,
    error: '',
    ...patch,
  });
  const q = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [GoogleCreativeImageLibraryComponent], providers: [provideHttpClient()] }).compileComponents();
    fixture = TestBed.createComponent(GoogleCreativeImageLibraryComponent);
  });

  function render(slot: GoogleCreativeImageSlotView): void {
    fixture.componentRef.setInput('slot', slot);
    fixture.detectChanges();
  }

  it('states the requirement and offers the picker and the upload', () => {
    render(view());

    expect(q(`google-image-library-requirement-${KEY}`)?.textContent).toContain('4:1 (within 1%), at least 512x128 px');
    expect(q(`google-image-library-pick-${KEY}`)).not.toBeNull();
    expect(q(`google-image-library-upload-${KEY}`)).not.toBeNull();
  });

  it('emits a pick and resets the picker for the next one', () => {
    render(view());
    const picks: string[] = [];
    fixture.componentInstance.pick.subscribe((id) => picks.push(id));
    const c = fixture.componentInstance as unknown as { pickForm: { controls: { asset: { setValue(v: string): void; value: string } } }; onPick(): void };
    c.pickForm.controls.asset.setValue('asset-2');
    c.onPick();

    expect(picks).toEqual(['asset-2']);
    expect(c.pickForm.controls.asset.value).toBe('');
  });

  it('lists held images with their problem and emits a remove', () => {
    render(view({ held: [{ id: 'asset-1', label: 'old.png', problem: 'Stored for a different brief.' }] }));
    const removed: string[] = [];
    fixture.componentInstance.remove.subscribe((id) => removed.push(id));

    expect(q(`google-image-library-problem-${KEY}-asset-1`)?.textContent).toContain('Stored for a different brief.');
    (q(`google-image-library-remove-${KEY}-asset-1`)?.querySelector('button') as HTMLButtonElement).click();
    expect(removed).toEqual(['asset-1']);
  });

  it('hides the picker and the upload on a full slot, saying so', () => {
    render(view({ canAdd: false, optionsNote: 'This slot is full.' }));

    expect(q(`google-image-library-pick-${KEY}`)).toBeNull();
    expect(q(`google-image-library-upload-${KEY}`)).toBeNull();
    expect(q(`google-image-library-note-${KEY}`)?.textContent).toContain('This slot is full.');
  });

  it('shows a running upload with Cancel in place of the chooser, and a failure as an alert', () => {
    render(view({ uploading: true }));
    expect(q(`google-image-library-cancel-${KEY}`)).not.toBeNull();
    expect(q(`google-image-library-upload-${KEY}`)).toBeNull();

    render(view({ error: 'image is not decodable' }));
    expect(q(`google-image-library-error-${KEY}`)?.getAttribute('role')).toBe('alert');
  });
});
