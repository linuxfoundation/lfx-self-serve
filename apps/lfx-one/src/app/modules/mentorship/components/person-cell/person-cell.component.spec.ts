// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';

import { PersonCellComponent } from './person-cell.component';

describe('PersonCellComponent', () => {
  let fixture: ComponentFixture<PersonCellComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const noteButton = (): HTMLButtonElement | null => element().querySelector<HTMLButtonElement>('button');

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PersonCellComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(PersonCellComponent);
    fixture.componentRef.setInput('name', 'Alex Rivera');
    fixture.componentRef.setInput('initials', 'AR');
    fixture.componentRef.setInput('avatarStyleClass', 'bg-blue-100 text-blue-700');
    fixture.detectChanges();
  });

  it('renders the person name with a tooltip, since the cell truncates it', () => {
    // Scoped to the text column: the avatar renders its own span of initials first.
    const name = element().querySelector('div.flex-col > span');

    expect(name?.textContent?.trim()).toBe('Alex Rivera');
    expect(name?.getAttribute('title')).toBe('Alex Rivera');
  });

  it('omits the note line entirely for a read-only table', () => {
    expect(noteButton()).toBeNull();
  });

  it('prompts for a note when the row has none, naming the person for a screen reader', () => {
    fixture.componentRef.setInput('noteLabel', 'Add note');
    fixture.componentRef.setInput('noteTestId', 'mentorship-mentee-note-mnt_1');
    fixture.detectChanges();

    const button = noteButton();
    expect(button?.textContent?.trim()).toBe('Add note');
    // The prompt is the tooltip, because "Add note" alone says nothing on hover.
    expect(button?.getAttribute('title')).toBe('Add a reviewer note for Alex Rivera');
    expect(button?.getAttribute('aria-label')).toBe('Add reviewer note for Alex Rivera');
    expect(button?.getAttribute('data-testid')).toBe('mentorship-mentee-note-mnt_1');
  });

  it('shows the note itself as the tooltip once one exists, and offers to edit it', () => {
    fixture.componentRef.setInput('noteLabel', 'Strong prerequisite work so far');
    fixture.componentRef.setInput('hasNote', true);
    fixture.detectChanges();

    const button = noteButton();
    expect(button?.getAttribute('title')).toBe('Strong prerequisite work so far');
    expect(button?.getAttribute('aria-label')).toBe('Edit reviewer note for Alex Rivera');
  });

  it('emits on click rather than owning the dialog', () => {
    fixture.componentRef.setInput('noteLabel', 'Add note');
    fixture.detectChanges();

    let emitted = 0;
    fixture.componentInstance.noteClick.subscribe(() => (emitted += 1));
    noteButton()?.click();

    expect(emitted).toBe(1);
  });
});
