// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_MENTEE_NOTE_MAX } from '@lfx-one/shared/constants';
import { MentorshipNoteDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeNoteDialogComponent } from './mentee-note-dialog.component';

describe('MenteeNoteDialogComponent', () => {
  const data: MentorshipNoteDialogData = { personName: 'Alex Rivera', note: 'the existing note' };

  let fixture: ComponentFixture<MenteeNoteDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  const build = (overrides: Partial<MentorshipNoteDialogData> = {}): void => {
    close = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeNoteDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { ...data, ...overrides } } },
      ],
    });

    fixture = TestBed.createComponent(MenteeNoteDialogComponent);
    fixture.detectChanges();
  };

  beforeEach(() => build());

  it('opens on the note the mentee already has', () => {
    expect(fixture.componentInstance['form'].controls.note.value).toBe('the existing note');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Alex Rivera');
  });

  it('closes with the trimmed note when saved', () => {
    fixture.componentInstance['form'].controls.note.setValue('  a revised note  ');
    fixture.componentInstance['onSave']();

    expect(close).toHaveBeenCalledWith('a revised note');
  });

  it('closes with an empty string when the note is cleared, which is an explicit clear', () => {
    fixture.componentInstance['form'].controls.note.setValue('');
    fixture.componentInstance['onSave']();

    expect(close).toHaveBeenCalledWith('');
  });

  it('closes with no value when dismissed, so the caller leaves the note untouched', () => {
    fixture.componentInstance['form'].controls.note.setValue('an abandoned edit');
    fixture.componentInstance['onCancel']();

    expect(close).toHaveBeenCalledWith();
  });

  it('refuses to save a note past the character cap', () => {
    fixture.componentInstance['form'].controls.note.setValue('x'.repeat(MENTORSHIP_MENTEE_NOTE_MAX + 1));
    fixture.componentInstance['onSave']();

    expect(close).not.toHaveBeenCalled();
  });

  it('counts the characters typed so far', () => {
    fixture.componentInstance['form'].controls.note.setValue('four');
    fixture.detectChanges();

    expect(fixture.componentInstance['noteLength']()).toBe(4);
  });
});
