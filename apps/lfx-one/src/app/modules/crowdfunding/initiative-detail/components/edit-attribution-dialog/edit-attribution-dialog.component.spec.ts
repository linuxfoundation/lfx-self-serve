// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { FundType } from '@lfx-one/shared/enums';
import { AttributionOptions, InitiativeAttribution, InitiativeDetail } from '@lfx-one/shared/interfaces';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditAttributionDialogComponent } from './edit-attribution-dialog.component';

const ORG_UID = '0014100000AcmeAAAA';
const PROJECT_UID = '00000000-0000-4000-8000-000000000001';
const OPTIONS: AttributionOptions = {
  organizations: [{ id: ORG_UID, name: 'Acme Motors' }],
  projects: [{ id: PROJECT_UID, name: 'Vendor Project' }],
};

function initiative(attribution?: InitiativeAttribution): InitiativeDetail {
  return {
    id: 'synthetic-initiative-1',
    slug: 'synthetic-initiative',
    name: 'Synthetic Initiative',
    description: '',
    status: 'submitted',
    initiativeType: FundType.GENERAL_FUND,
    color: '',
    createdOn: '2026-01-01T00:00:00Z',
    updatedOn: '2026-01-01T00:00:00Z',
    isOwner: true,
    attribution,
  };
}

// Reads protected members; the template binds them, so they are the component's working surface.
interface DialogInternals {
  form: FormGroup<{ type: FormControl<string>; entityUid: FormControl<string | null> }>;
  canSave: () => boolean;
  options: () => AttributionOptions | null | undefined;
  saveError: () => string | null;
  onTypeChange: () => void;
  onSave: () => Promise<void>;
}

describe('EditAttributionDialogComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;

  const create = (current?: InitiativeAttribution, options: Observable<AttributionOptions> = of(OPTIONS)) => {
    close = vi.fn();
    update = vi.fn();
    TestBed.configureTestingModule({
      imports: [EditAttributionDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { initiative: initiative(current) } } },
        { provide: CrowdfundingService, useValue: { getAttributionOptions: () => options, updateInitiativeAttribution: update } },
      ],
    });
    const fixture = TestBed.createComponent(EditAttributionDialogComponent);
    fixture.detectChanges();
    return { fixture, dialog: fixture.componentInstance as unknown as DialogInternals };
  };

  const choose = (dialog: DialogInternals, type: string, entityUid: string | null = null) => {
    dialog.form.controls.type.setValue(type);
    dialog.onTypeChange();
    dialog.form.controls.entityUid.setValue(entityUid);
  };

  afterEach(() => TestBed.resetTestingModule());

  it('offers Save only for a change', () => {
    const { dialog } = create({ type: 'organization', entityUid: ORG_UID });
    expect(dialog.canSave()).toBe(false);

    choose(dialog, 'organization', ORG_UID);
    expect(dialog.canSave()).toBe(false);

    choose(dialog, 'personal');
    expect(dialog.canSave()).toBe(true);
  });

  it('needs a target before saving an organization or project', () => {
    const { dialog } = create();
    choose(dialog, 'project');
    expect(dialog.canSave()).toBe(false);

    choose(dialog, 'project', PROJECT_UID);
    expect(dialog.canSave()).toBe(true);
  });

  it('saves the chosen target and closes with the updated initiative', async () => {
    const { dialog } = create();
    const updated = initiative({ type: 'organization', entityUid: ORG_UID, name: 'Acme Motors' });
    update.mockReturnValue(of(updated));

    choose(dialog, 'organization', ORG_UID);
    await dialog.onSave();

    expect(update).toHaveBeenCalledWith('synthetic-initiative-1', { type: 'organization', entityUid: ORG_UID });
    expect(close).toHaveBeenCalledWith(updated);
  });

  it('sends personal without an entity', async () => {
    const { dialog } = create({ type: 'project', entityUid: PROJECT_UID });
    update.mockReturnValue(of(initiative()));

    choose(dialog, 'personal');
    await dialog.onSave();

    expect(update).toHaveBeenCalledWith('synthetic-initiative-1', { type: 'personal' });
  });

  it.each([
    [403, 'affiliated'],
    [400, 'submitted for review'],
    [500, 'Please try again'],
  ])('keeps the dialog open and explains a %s', async (status, message) => {
    const { dialog } = create();
    update.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));

    choose(dialog, 'organization', ORG_UID);
    await dialog.onSave();

    expect(close).not.toHaveBeenCalled();
    expect(dialog.saveError()).toContain(message);
  });

  it('shows an error instead of an empty list when the options fail to load', () => {
    const { fixture, dialog } = create(
      undefined,
      throwError(() => new HttpErrorResponse({ status: 502 }))
    );
    choose(dialog, 'organization');
    fixture.detectChanges();

    expect(dialog.options()).toBeNull();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="initiative-edit-attribution-options-error"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="initiative-edit-attribution-empty"]')).toBeNull();
  });

  it('explains when the caller has no organizations to choose from', () => {
    const { fixture, dialog } = create(undefined, of({ organizations: [], projects: OPTIONS.projects }));
    choose(dialog, 'organization');
    fixture.detectChanges();

    const empty = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="initiative-edit-attribution-empty"]');
    expect(empty?.textContent).toContain('any organization');
  });
});
