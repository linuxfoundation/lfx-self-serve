// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectSettings, StaffEditDialogData, UserInfo } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectStaffCardComponent } from './project-staff-card.component';
import { StaffEditDialogComponent } from './staff-edit-dialog/staff-edit-dialog.component';

describe('ProjectStaffCardComponent', () => {
  let fixture: ComponentFixture<ProjectStaffCardComponent>;
  let canWrite: WritableSignal<boolean>;
  let getProjectSettings: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  /** Stands in for the dialog's own close stream so each test drives the result it needs. */
  let onClose: Subject<unknown>;

  const ED: UserInfo = { name: 'Assigned ED', email: 'ed@example.com' };

  function buildSettings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
    return {
      uid: 'project-1',
      announcement_date: '2026-01-01',
      writers: [],
      auditors: [],
      executive_director: ED,
      // program_manager and opportunity_owner deliberately absent — the unassigned-row rendering
      // and the non-editable row are both load-bearing here.
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    canWrite = signal(false);
    getProjectSettings = vi.fn(() => of(buildSettings()));
    onClose = new Subject<unknown>();
    open = vi.fn(() => ({ onClose }));
  });

  async function render(settings$?: Observable<ProjectSettings>): Promise<void> {
    if (settings$) {
      getProjectSettings.mockReturnValue(settings$);
    }

    await TestBed.configureTestingModule({
      imports: [ProjectStaffCardComponent],
      providers: [
        { provide: PermissionsService, useValue: { getProjectSettings } },
        { provide: ProjectContextService, useValue: { canWrite } },
        { provide: DialogService, useValue: { open } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectStaffCardComponent);
    // Set before the first change detection: `toObservable(this.projectUid)` reads the required
    // input in an effect, which throws NG0950 if the input is still unset when it first runs.
    fixture.componentRef.setInput('projectUid', 'project-1');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function editButton(role: string): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="project-staff-card-edit-${role}"]`);
  }

  /** The name/"Not Set" text itself as a control — PCC's edit affordance on this card. */
  function nameButton(role: string): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="project-staff-card-name-${role}"]`);
  }

  function managedHint(role: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="project-staff-card-managed-${role}"]`);
  }

  function rowText(role: string): string {
    return fixture.nativeElement.querySelector(`[data-testid="project-staff-card-row-${role}"]`)?.textContent ?? '';
  }

  /** The dialog data of the Nth DialogService.open call. */
  function openedWith(call = 0): StaffEditDialogData {
    return open.mock.calls[call][1].data;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('gives a read-only viewer no edit affordance on any row', async () => {
    await render();

    // The gate is the only thing between a viewer and the write UI — every role, not just the
    // editable ones, and not the "managed elsewhere" hint either, which only makes sense to
    // someone who could otherwise expect to edit.
    for (const role of ['executive_director', 'program_manager', 'opportunity_owner']) {
      expect(editButton(role)).toBeNull();
      expect(nameButton(role)).toBeNull();
      expect(managedHint(role)).toBeNull();
    }
    // The rows themselves still render — the card is informational for viewers.
    expect(rowText('executive_director')).toContain('Assigned ED');
  });

  it('gives a writer edit buttons on the editable roles only', async () => {
    canWrite.set(true);
    await render();

    expect(editButton('executive_director')).not.toBeNull();
    expect(editButton('program_manager')).not.toBeNull();
    // Opportunity Owner is owned by PCC/Salesforce, so it gets the explanatory hint instead of
    // a control that would write to a system this route does not own.
    expect(editButton('opportunity_owner')).toBeNull();
    expect(managedHint('opportunity_owner')).not.toBeNull();
  });

  it('makes the name itself the edit affordance on the editable roles only', async () => {
    canWrite.set(true);
    await render();

    // Clicking the name is how PCC's Project Staff card opens this editor, so the same click
    // has to work here. Opportunity Owner is written elsewhere, so its name stays static text.
    expect(nameButton('executive_director')).not.toBeNull();
    expect(nameButton('program_manager')).not.toBeNull();
    expect(nameButton('opportunity_owner')).toBeNull();
  });

  it('opens the editor from the name, including an unassigned row', async () => {
    canWrite.set(true);
    await render();

    nameButton('executive_director')!.click();
    await settle();

    expect(openedWith()).toMatchObject({ role: 'executive_director', currentUser: ED });

    // "Not Set" is the same affordance, so an empty role can be filled without hunting for the
    // pencil.
    nameButton('program_manager')!.click();
    await settle();

    expect(openedWith(1)).toMatchObject({ role: 'program_manager', currentUser: null });
  });

  it('renders an unassigned role as Not Set while keeping its label', async () => {
    await render();

    expect(rowText('program_manager')).toContain('Not Set');
    expect(rowText('program_manager')).toContain('Program Manager');
  });

  it('opens the editor with the row it was clicked from', async () => {
    canWrite.set(true);
    await render();

    editButton('executive_director')!.click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(StaffEditDialogComponent);
    expect(openedWith()).toEqual({
      projectUid: 'project-1',
      role: 'executive_director',
      roleLabel: 'Executive Director',
      currentUser: ED,
    });
  });

  it('passes a null currentUser for an unassigned role', async () => {
    canWrite.set(true);
    await render();

    editButton('program_manager')!.click();
    await settle();

    // Not `undefined`: the dialog branches on `data.currentUser` for both the pre-fill and the
    // remove affordance, and only null tells it the role is genuinely unassigned.
    expect(openedWith().currentUser).toBeNull();
  });

  it('opens the dialog with every implicit dismissal disabled', async () => {
    canWrite.set(true);
    await render();

    editButton('executive_director')!.click();
    await settle();

    // A mask/Esc/X close mid-submit emits a falsey onClose result, the card skips the refresh,
    // and the in-flight write's later close(true) is a no-op — leaving the card stale after a
    // save that actually succeeded. closeOnEscape defaults to true independently of closable,
    // so all three have to be off.
    expect(open.mock.calls[0][1]).toMatchObject({ closable: false, dismissableMask: false, closeOnEscape: false });
  });

  it('re-reads the settings when the dialog reports a save', async () => {
    canWrite.set(true);
    await render();

    expect(getProjectSettings).toHaveBeenCalledTimes(1);

    editButton('executive_director')!.click();
    await settle();

    onClose.next(true);
    await settle();

    expect(getProjectSettings).toHaveBeenCalledTimes(2);
    expect(getProjectSettings).toHaveBeenLastCalledWith('project-1');
  });

  it('does not re-read when the dialog closes without a save', async () => {
    canWrite.set(true);
    await render();

    editButton('executive_director')!.click();
    await settle();

    // The shape a Cancel emits.
    onClose.next(undefined);
    await settle();

    expect(getProjectSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the error state and no rows when the settings read fails', async () => {
    await render(throwError(() => new Error('boom')));

    expect(fixture.nativeElement.querySelector('[data-testid="project-staff-card-error"]')).not.toBeNull();
    // A failed read must not fall through to the row list — three "Not Set" rows would read as
    // "this project has no staff", which is a different fact than "we could not load it".
    expect(fixture.nativeElement.querySelector('[data-testid="project-staff-card-row-executive_director"]')).toBeNull();
  });
});
