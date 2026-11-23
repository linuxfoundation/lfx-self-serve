// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { MailingListSyncMode } from '@lfx-one/shared/enums';
import { GroupsIOMailingList, GroupsIOService } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MailingListManageComponent } from './mailing-list-manage.component';

/**
 * Exercises prepareMailingListData's sync_mode branch (#4880 review): this form has no sync
 * direction control, so the reset-on-committee-change logic lives entirely here, parallel to
 * buildMlUpdatePayload in committee-settings-tab.component.ts (see that component's spec).
 */
describe('MailingListManageComponent — sync_mode on committee change (#4880 review)', () => {
  const EXISTING_LIST = (committeeUid: string): GroupsIOMailingList =>
    ({
      uid: 'ml-1',
      group_name: 'test-list',
      description: '<p>An existing test mailing list</p>',
      public: true,
      type: 'discussion_open',
      audience_access: 'public',
      committees: [{ uid: committeeUid }],
      sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
    }) as GroupsIOMailingList;

  const SERVICE = { uid: 'service-1', type: 'primary', prefix: '' } as unknown as GroupsIOService;

  async function createComponent(existingList: GroupsIOMailingList): Promise<MailingListManageComponent> {
    const getMailingList = vi.fn(() => of(existingList));
    const updateMailingList = vi.fn(() => of({}));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MailingListService, useValue: { getMailingList, updateMailingList, getServicesByProject: vi.fn(() => of([])) } },
        { provide: ProjectContextService, useValue: { activeContext: signal(null), canWrite: signal(true) } },
        { provide: ProjectService, useValue: { getProject: vi.fn(() => of(null)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });

    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { paramMap: of(convertToParamMap({ id: 'ml-1' })), queryParamMap: of(convertToParamMap({})) },
    });

    const component = TestBed.runInInjectionContext(() => new MailingListManageComponent());
    expect(getMailingList).toHaveBeenCalledWith('ml-1');
    return component;
  }

  it('keeps sync_mode when the committee picked in step 3 is unchanged', async () => {
    const component = await createComponent(EXISTING_LIST('committee-1'));

    const payload = (component as any).prepareMailingListData(SERVICE);

    expect(payload.committee_uid).toBe('committee-1');
    expect(payload.sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);
  });

  it('resets sync_mode to MANUAL when a different committee is picked in step 3', async () => {
    const component = await createComponent(EXISTING_LIST('committee-OLD'));
    component.form().patchValue({ committees: { uid: 'committee-NEW' } });

    const payload = (component as any).prepareMailingListData(SERVICE);

    expect(payload.committee_uid).toBe('committee-NEW');
    expect(payload.sync_mode).toBe(MailingListSyncMode.MANUAL);
  });

  it('omits sync_mode when the committee is cleared in step 3', async () => {
    const component = await createComponent(EXISTING_LIST('committee-1'));
    component.form().patchValue({ committees: null });

    const payload = (component as any).prepareMailingListData(SERVICE);

    expect(payload.committee_uid).toBeNull();
    expect(payload.sync_mode).toBeUndefined();
  });
});
