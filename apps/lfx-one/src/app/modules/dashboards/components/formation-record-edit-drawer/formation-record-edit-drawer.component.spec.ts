// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FormationRecordEditDrawerComponent } from './formation-record-edit-drawer.component';

function stored(overrides: Partial<Project> = {}): Project {
  return {
    uid: 'proj-1',
    slug: 'cascade-data',
    name: 'Cascade Data',
    description: 'Synthetic',
    stage: 'Formation - Engaged',
    legal_entity_type: 'Series LLC',
    legal_entity_name: 'Cascade Data LLC',
    formation_date: '2026-01-15',
    ...overrides,
  } as Project;
}

describe('FormationRecordEditDrawerComponent', () => {
  let fixture: ComponentFixture<FormationRecordEditDrawerComponent>;
  const query = (selector: string): Element | null => document.body.querySelector(selector);
  const form = (): FormGroup => (fixture.componentInstance as unknown as { form: FormGroup }).form;

  async function render(options: { project?: Project; update?: ReturnType<typeof vi.fn>; openRequiredCount?: number } = {}) {
    TestBed.resetTestingModule();
    const getProjectRecord = vi.fn(() => of(options.project ?? stored()));
    const updateFormationRecord = options.update ?? vi.fn(() => of(stored()));
    const add = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FormationRecordEditDrawerComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add } },
        { provide: ProjectService, useValue: { getProjectRecord, updateFormationRecord } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationRecordEditDrawerComponent);
    fixture.componentRef.setInput('projectUid', 'proj-1');
    fixture.componentRef.setInput('openRequiredCount', options.openRequiredCount ?? 0);
    fixture.detectChanges();
    fixture.componentInstance.visible.set(true);
    await fixture.whenStable();
    fixture.detectChanges();

    return { updateFormationRecord, getProjectRecord, add };
  }

  async function save(): Promise<void> {
    (fixture.componentInstance as unknown as { onSave(): void }).onSave();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('loads the stored record into the form when opened', async () => {
    const { getProjectRecord } = await render();

    expect(getProjectRecord).toHaveBeenCalledWith('proj-1');
    expect(form().value).toMatchObject({ stage: 'Formation - Engaged', legal_entity_name: 'Cascade Data LLC', legal_entity_type: 'Series LLC' });
  });

  it('sends only the fields that changed', async () => {
    const { updateFormationRecord } = await render();
    form().patchValue({ legal_entity_name: 'Cascade Data Inc.' });

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { legal_entity_name: 'Cascade Data Inc.' });
  });

  it('does not call the API when nothing changed', async () => {
    const { updateFormationRecord, add } = await render();

    await save();

    expect(updateFormationRecord).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Nothing to save' }));
  });

  it('shows the dissolution date field only for Archived and blocks saving without it', async () => {
    const { updateFormationRecord } = await render();
    expect(query('[data-testid="formation-record-dissolution-date"]')).toBeNull();

    form().patchValue({ stage: 'Archived' });
    fixture.detectChanges();
    expect(query('[data-testid="formation-record-dissolution-date"]')).not.toBeNull();

    await save();

    expect(query('[data-testid="formation-record-dissolution-date-error"]')?.textContent).toContain('Archiving needs a dissolution date.');
    expect(updateFormationRecord).not.toHaveBeenCalled();
  });

  it('asks for confirmation before Active, naming the checklist effect and open required count, then saves on confirm', async () => {
    const { updateFormationRecord } = await render({ openRequiredCount: 3 });
    form().patchValue({ stage: 'Active' });

    await save();

    const confirmation = query('[data-testid="formation-record-confirmation"]');
    expect(confirmation?.textContent).toContain('completes its formation checklist');
    expect(confirmation?.textContent).toContain('3 required items are still open');
    expect(updateFormationRecord).not.toHaveBeenCalled();

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { stage: 'Active' });
  });

  it('describes Formation - Disengaged as freezing the checklist', async () => {
    await render({ openRequiredCount: 1 });
    form().patchValue({ stage: 'Formation - Disengaged' });

    await save();

    const text = query('[data-testid="formation-record-confirmation"]')?.textContent ?? '';
    expect(text).toContain('freezes its formation checklist');
    expect(text).toContain('1 required item is still open');
  });

  it('does not ask for confirmation when moving between formation sub-stages', async () => {
    const { updateFormationRecord } = await render();
    form().patchValue({ stage: 'Formation - On Hold' });

    await save();

    expect(query('[data-testid="formation-record-confirmation"]')).toBeNull();
    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { stage: 'Formation - On Hold' });
  });

  it('keeps a stored Confidential stage visible but never sends it unless the user changed the stage', async () => {
    const { updateFormationRecord } = await render({ project: stored({ stage: 'Formation - Confidential' }) });
    form().patchValue({ legal_entity_name: 'Renamed LLC' });

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { legal_entity_name: 'Renamed LLC' });
  });

  it('treats a cleared legal entity type (null from the select) as an empty-string change', async () => {
    const { updateFormationRecord } = await render();
    form().patchValue({ legal_entity_type: null });

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { legal_entity_type: '' });
  });

  it('blocks clearing the dissolution date of an already-Archived project', async () => {
    const { updateFormationRecord } = await render({ project: stored({ stage: 'Archived', entity_dissolution_date: '2026-10-31' }) });
    form().patchValue({ entity_dissolution_date: '' });

    await save();

    expect(query('[data-testid="formation-record-dissolution-date-error"]')).not.toBeNull();
    expect(updateFormationRecord).not.toHaveBeenCalled();
  });

  it('refetches on reopen after a failed load', async () => {
    const { getProjectRecord } = await render();
    getProjectRecord.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    fixture.componentInstance.visible.set(false);
    fixture.componentInstance.visible.set(true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(query('[data-testid="formation-record-edit-load-error"]')).not.toBeNull();

    fixture.componentInstance.visible.set(false);
    fixture.componentInstance.visible.set(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getProjectRecord).toHaveBeenCalledTimes(3);
    expect(query('[data-testid="formation-record-edit-load-error"]')).toBeNull();
  });

  it.each([
    [403, { code: 'NOT_PROJECT_WRITER' }, "You don't have permission to edit this project."],
    [403, { code: 'FORMATION_TEAM_REQUIRED' }, 'Only the formation team can change stage and legal entity.'],
    [400, { code: 'VALIDATION_ERROR' }, "That value can't be saved. Check the fields and try again."],
    [409, { code: 'FORMATION_RECORD_CONFLICT' }, 'Someone else changed this project. Reload to see the latest, then try again.'],
    [404, { code: 'NOT_FOUND' }, "This project couldn't be found."],
    [503, {}, "Couldn't save. Try again."],
  ])('maps a %s response to the table copy', async (status, body, copy) => {
    const update = vi.fn(() => throwError(() => new HttpErrorResponse({ status, error: body })));
    await render({ update });
    form().patchValue({ legal_entity_name: 'Changed' });

    await save();

    expect(query('[data-testid="formation-record-edit-error"]')?.textContent).toContain(copy);
    expect(!!query('[data-testid="formation-record-edit-reload"]')).toBe(status === 409);
  });

  it('closes, toasts and emits saved after a successful save', async () => {
    const { add } = await render();
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    form().patchValue({ legal_entity_name: 'Changed' });

    await save();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    expect(saved).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.visible()).toBe(false);
  });
});
