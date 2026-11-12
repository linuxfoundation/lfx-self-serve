// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { Project, UpdateFormationRecordRequest } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { map, NEVER, Observable, of, Subject, throwError } from 'rxjs';
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

/** The drawer keeps its form state in protected signals; tests drive them the way the bound uikit controls do. */
interface DrawerState {
  stage: { (): string | null; set(value: string | null): void };
  stageOptions(): { value: string; label: string; disabled: boolean }[];
  legalEntityType: { set(value: string | null): void };
  legalEntityName: { set(value: string): void };
  dissolutionDate: { set(value: string): void };
  onSave(): void;
  onBack(): void;
}

describe('FormationRecordEditDrawerComponent', () => {
  let fixture: ComponentFixture<FormationRecordEditDrawerComponent>;
  const state = (): DrawerState => fixture.componentInstance as unknown as DrawerState;
  const query = (selector: string): Element | null => fixture.nativeElement.querySelector(selector);

  async function render(options: { project?: Project; update?: ReturnType<typeof vi.fn>; openRequiredCount?: number; load?: ReturnType<typeof vi.fn> } = {}) {
    TestBed.resetTestingModule();
    const getProjectRecord = options.load ?? vi.fn(() => of(options.project ?? stored()));
    const updateFormationRecord = options.update ?? vi.fn(() => of(stored()));
    const send = updateFormationRecord as unknown as (uid: string, changes: UpdateFormationRecordRequest) => Observable<Project>;
    const add = vi.fn();
    const close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FormationRecordEditDrawerComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: DIALOG_DATA,
          useValue: {
            projectUid: 'proj-1',
            openRequiredCount: options.openRequiredCount ?? 0,
            // The card owns the write; the drawer only gets the outcome stream.
            save: (changes: UpdateFormationRecordRequest) => send('proj-1', changes).pipe(map(() => undefined)),
          },
        },
        { provide: DialogRef, useValue: { close, id: 'dialog-1' } },
        { provide: MessageService, useValue: { add } },
        { provide: ProjectService, useValue: { getProjectRecord, updateFormationRecord } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationRecordEditDrawerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { updateFormationRecord, getProjectRecord, add, close };
  }

  async function save(): Promise<void> {
    state().onSave();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('reads the record once when the drawer opens and fills the form', async () => {
    const { getProjectRecord } = await render();

    expect(getProjectRecord).toHaveBeenCalledTimes(1);
    expect(getProjectRecord).toHaveBeenCalledWith('proj-1');
    expect(state().stage()).toBe('Formation - Engaged');
    expect(query('[data-testid="formation-record-edit-loading"]')).toBeNull();
  });

  // #5619: the formation team calls a v2 `Prospect` "Draft"; the stored value never changes.
  it('shows a stored Prospect stage as Draft while keeping its value', async () => {
    await render({ project: stored({ stage: 'Prospect' }) });

    expect(state().stage()).toBe('Prospect');
    expect(state().stageOptions()[0]).toEqual({ value: 'Prospect', label: 'Draft', disabled: true });
    expect(
      state()
        .stageOptions()
        .slice(1)
        .every((option) => option.label === option.value)
    ).toBe(true);
  });

  it('sends only the fields that changed', async () => {
    const { updateFormationRecord } = await render();
    state().legalEntityName.set('Cascade Data Inc.');

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { legal_entity_name: 'Cascade Data Inc.' });
  });

  it('does not send an untouched name whose stored value has surrounding whitespace', async () => {
    const { updateFormationRecord } = await render({ project: stored({ legal_entity_name: '  Cascade Data LLC ' }) });
    state().stage.set('Formation - On Hold');

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { stage: 'Formation - On Hold' });
  });

  it('does not call the API when nothing changed, even if the stored values have stray whitespace', async () => {
    const { updateFormationRecord, add } = await render({ project: stored({ legal_entity_name: '  Cascade Data LLC ' }) });

    await save();

    expect(updateFormationRecord).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Nothing to save' }));
  });

  it('does not resend a stored dissolution date when only the stage changes to Archived', async () => {
    const { updateFormationRecord } = await render({ project: stored({ entity_dissolution_date: '2026-09-30' }) });
    state().stage.set('Archived');

    await save(); // Archived asks for confirmation first
    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { stage: 'Archived' });
  });

  it('shows the dissolution date field only for Archived and blocks Archived when none is set', async () => {
    const { updateFormationRecord } = await render();
    expect(query('[data-testid="formation-record-dissolution-date"]')).toBeNull();

    state().stage.set('Archived');
    fixture.detectChanges();
    expect(query('[data-testid="formation-record-dissolution-date"]')).not.toBeNull();

    await save();

    expect(fixture.nativeElement.textContent).toContain('Archiving needs a dissolution date.');
    expect(updateFormationRecord).not.toHaveBeenCalled();
  });

  it('sends a newly entered dissolution date with Archived', async () => {
    const { updateFormationRecord } = await render();
    state().stage.set('Archived');
    state().dissolutionDate.set('2026-10-31');

    await save();
    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { stage: 'Archived', entity_dissolution_date: '2026-10-31' });
  });

  it('blocks clearing the dissolution date of an already-Archived project', async () => {
    const { updateFormationRecord } = await render({ project: stored({ stage: 'Archived', entity_dissolution_date: '2026-10-31' }) });
    state().dissolutionDate.set('');

    await save();

    expect(fixture.nativeElement.textContent).toContain('Archiving needs a dissolution date.');
    expect(updateFormationRecord).not.toHaveBeenCalled();
  });

  it('asks for confirmation before Active, naming the formation-items effect and open required count, then saves on confirm', async () => {
    const { updateFormationRecord } = await render({ openRequiredCount: 3 });
    state().stage.set('Active');

    await save();

    const confirmation = query('[data-testid="formation-record-confirmation"]');
    expect(confirmation?.textContent).toContain('completes its formation.');
    expect(confirmation?.textContent).toContain('3 required items are still open');
    expect(updateFormationRecord).not.toHaveBeenCalled();

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { stage: 'Active' });
  });

  it('describes Formation - Disengaged as freezing the formation items', async () => {
    await render({ openRequiredCount: 1 });
    state().stage.set('Formation - Disengaged');

    await save();

    const text = query('[data-testid="formation-record-confirmation"]')?.textContent ?? '';
    expect(text).toContain('freezes its formation items');
    expect(text).toContain('1 required item is still open');
  });

  it('drops a pending confirmation when the stage pick changes', async () => {
    await render();
    state().stage.set('Active');
    await save();
    expect(query('[data-testid="formation-record-confirmation"]')).not.toBeNull();

    state().stage.set('Formation - On Hold');
    fixture.detectChanges();

    expect(query('[data-testid="formation-record-confirmation"]')).toBeNull();
  });

  it('does not ask for confirmation when moving between formation sub-stages', async () => {
    const { updateFormationRecord } = await render();
    state().stage.set('Formation - On Hold');

    await save();

    expect(query('[data-testid="formation-record-confirmation"]')).toBeNull();
    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { stage: 'Formation - On Hold' });
  });

  it('keeps a stored Confidential stage visible but never sends it unless the user changed the stage', async () => {
    const { updateFormationRecord } = await render({ project: stored({ stage: 'Formation - Confidential' }) });
    state().legalEntityName.set('Renamed LLC');

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { legal_entity_name: 'Renamed LLC' });
  });

  it('clears the legal entity type through the empty "Not set" option, which is separate from the real "None" value', async () => {
    const { updateFormationRecord } = await render();
    state().legalEntityType.set('');

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { legal_entity_type: '' });
  });

  it('shows a retry when the record cannot be read, and does not offer Save', async () => {
    const load = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
      .mockReturnValue(of(stored()));
    await render({ load });

    expect(query('[data-testid="formation-record-edit-load-error"]')).not.toBeNull();

    (query('[data-testid="formation-record-edit-retry"]') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(load).toHaveBeenCalledTimes(2);
    expect(query('[data-testid="formation-record-edit-load-error"]')).toBeNull();
    expect(state().stage()).toBe('Formation - Engaged');
  });

  it('ignores Save while the record is still loading', async () => {
    const { updateFormationRecord } = await render({ load: vi.fn(() => NEVER) });

    await save();

    expect(updateFormationRecord).not.toHaveBeenCalled();
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
    state().legalEntityName.set('Changed');

    await save();

    expect(query('[data-testid="formation-record-edit-error"]')?.textContent).toContain(copy);
    expect(!!query('[data-testid="formation-record-edit-reload"]')).toBe(status === 409);
  });

  it('stores None as a real value, not as a clear', async () => {
    const { updateFormationRecord } = await render();
    state().legalEntityType.set('None');

    await save();

    expect(updateFormationRecord).toHaveBeenCalledWith('proj-1', { legal_entity_type: 'None' });
  });

  it('shows the archive copy when the BFF reports the dissolution date rule on the merged record', async () => {
    const update = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              errors: [{ field: 'entity_dissolution_date', message: 'Archiving needs a dissolution date.', code: 'DISSOLUTION_DATE_REQUIRED' }],
            },
          })
      )
    );
    await render({ update, project: stored({ entity_dissolution_date: '2026-09-30' }) });
    state().stage.set('Archived');

    await save();
    await save();

    expect(query('[data-testid="formation-record-edit-error"]')?.textContent).toContain('Archiving needs a dissolution date.');
  });

  it('keeps the generic invalid-value copy for a malformed date on the same field', async () => {
    const update = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              errors: [
                { field: 'entity_dissolution_date', message: "That value can't be saved. Check the fields and try again.", code: 'FIELD_VALIDATION_ERROR' },
              ],
            },
          })
      )
    );
    await render({ update, project: stored({ entity_dissolution_date: '2026-09-30' }) });
    state().stage.set('Archived');
    state().dissolutionDate.set('2026-10-31');

    await save();
    await save();

    const text = query('[data-testid="formation-record-edit-error"]')?.textContent ?? '';
    expect(text).toContain("That value can't be saved. Check the fields and try again.");
    expect(text).not.toContain('Archiving needs a dissolution date.');
  });

  it('disables Cancel while the save is pending and closes with true once it lands', async () => {
    const pending = new Subject<Project>();
    const { close } = await render({ update: vi.fn(() => pending) });
    state().legalEntityName.set('Changed');

    await save();

    expect((query('[data-testid="formation-record-cancel"] button') as HTMLButtonElement).disabled).toBe(true);

    pending.next(stored());
    pending.complete();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledWith(true);
  });

  it('closes the drawer with true after a successful save and leaves the success toast to the card that owns the write', async () => {
    const { add, close } = await render();
    state().legalEntityName.set('Changed');

    await save();

    expect(close).toHaveBeenCalledWith(true);
    expect(add).not.toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('ignores the outcome once it has been destroyed mid-save (the write itself is not its to cancel)', async () => {
    const pending = new Subject<Project>();
    const { close } = await render({ update: vi.fn(() => pending) });
    state().legalEntityName.set('Changed');
    await save();

    fixture.destroy();
    pending.next(stored());
    pending.complete();

    expect(pending.observed).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('closes with false on cancel', async () => {
    const { close } = await render();

    (query('[data-testid="formation-record-cancel"]') as HTMLElement).click();

    expect(close).toHaveBeenCalledWith(false);
  });
});
