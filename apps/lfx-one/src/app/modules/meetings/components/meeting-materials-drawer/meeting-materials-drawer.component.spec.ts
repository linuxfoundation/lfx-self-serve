// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MeetingAttachment, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetingMaterialsDrawerComponent } from './meeting-materials-drawer.component';

const OCCURRENCE_ID = '1893456000';
const OTHER_OCCURRENCE_ID = '1894060800';

const occurrence = { occurrence_id: OCCURRENCE_ID, start_time: '2030-01-01T00:00:00.000Z', duration: 60 } as MeetingOccurrence;

function attachment(partial: Partial<MeetingAttachment>): MeetingAttachment {
  return {
    uid: 'a1',
    meeting_id: 'm1',
    type: 'link',
    name: 'Agenda',
    link: 'https://example.com/agenda',
    category: 'Other',
    created_at: '2030-01-01T00:00:00Z',
    ...partial,
  };
}

/** A small PDF the drawer's file validation accepts. */
function pdf(name: string): File {
  return new File(['x'], name, { type: 'application/pdf' });
}

async function mount(options: { occurrence?: MeetingOccurrence | null; canScope?: boolean; attachments?: MeetingAttachment[]; pastMeetingId?: string } = {}) {
  const meetingService = {
    getMeetingAttachments: vi.fn().mockReturnValue(of(options.attachments ?? [])),
    getPastMeetingAttachments: vi.fn().mockReturnValue(of([])),
    createMeetingAttachment: vi.fn().mockReturnValue(of(attachment({ uid: 'new' }))),
    createPastMeetingAttachment: vi.fn().mockReturnValue(of(attachment({ uid: 'new' }))),
    updateMeetingAttachment: vi.fn().mockReturnValue(of(undefined)),
    deleteMeetingAttachment: vi.fn().mockReturnValue(of(undefined)),
    uploadMeetingFile: vi.fn().mockReturnValue(of({ uid: 'file-1', type: 'file', name: 'notes.pdf' })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: MeetingService, useValue: meetingService },
      { provide: MessageService, useValue: { add: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(MeetingMaterialsDrawerComponent, { set: { template: '', imports: [] } });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(MeetingMaterialsDrawerComponent);
  fixture.componentRef.setInput('meetingId', 'm1');
  if (options.pastMeetingId) fixture.componentRef.setInput('pastMeetingId', options.pastMeetingId);
  fixture.componentRef.setInput('occurrence', options.occurrence ?? null);
  fixture.componentRef.setInput('canScopeToOccurrence', options.canScope ?? options.occurrence != null);
  fixture.detectChanges();
  // Opening the drawer is what loads the attachments.
  fixture.componentInstance.visible.set(true);
  fixture.detectChanges();
  await fixture.whenStable();
  return { component: fixture.componentInstance, meetingService };
}

describe('MeetingMaterialsDrawerComponent — occurrence scope', () => {
  describe('what is offered', () => {
    it('offers the scope choice for a scopable occurrence', async () => {
      expect((await mount({ occurrence })).component.canScope()).toBe(true);
    });

    it('does not offer the scope choice without a scopable occurrence', async () => {
      expect((await mount({ occurrence: null })).component.canScope()).toBe(false);
    });

    it('never offers the scope choice for a past meeting', async () => {
      expect((await mount({ occurrence, pastMeetingId: 'm1-1893456000000' })).component.canScope()).toBe(false);
    });
  });

  describe('the scope radio group', () => {
    it('is named per meeting and occurrence so drawers on one page do not share a group', async () => {
      const first = (await mount({ occurrence })).component.scopeRadioName();
      TestBed.resetTestingModule();
      const second = (await mount({ occurrence: { ...occurrence, occurrence_id: OTHER_OCCURRENCE_ID } })).component.scopeRadioName();

      expect(first).toBe(`materials-scope-m1-${OCCURRENCE_ID}`);
      expect(second).toBe(`materials-scope-m1-${OTHER_OCCURRENCE_ID}`);
    });
  });

  describe('what is listed', () => {
    const series = attachment({ uid: 'series' });
    const mine = attachment({ uid: 'mine', occurrence_id: OCCURRENCE_ID });
    const other = attachment({ uid: 'other', occurrence_id: OTHER_OCCURRENCE_ID });

    it("lists the series-wide attachments and the managed occurrence's, not another date's", async () => {
      const { component } = await mount({ occurrence, attachments: [series, mine, other] });
      expect(component.linkAttachments().map((a) => a.uid)).toEqual(['series', 'mine']);
    });

    it('lists only series-wide attachments when no occurrence is scopable', async () => {
      const { component } = await mount({ occurrence: null, attachments: [series, mine, other] });
      expect(component.linkAttachments().map((a) => a.uid)).toEqual(['series']);
    });
  });

  describe('adding materials', () => {
    it('adds a link to every occurrence by default', async () => {
      const { component, meetingService } = await mount({ occurrence });
      component.newLinkTitle.set('Repo');
      component.newLinkUrl.set('https://example.com/repo');

      component.addLink();

      const body = meetingService.createMeetingAttachment.mock.calls[0][1];
      expect(body).not.toHaveProperty('occurrence_id');
    });

    it('scopes a new link to the managed occurrence when "this occurrence" is chosen', async () => {
      const { component, meetingService } = await mount({ occurrence });
      component.setNewItemScope('occurrence');
      component.newLinkTitle.set('Repo');
      component.newLinkUrl.set('https://example.com/repo');

      component.addLink();

      expect(meetingService.createMeetingAttachment).toHaveBeenCalledWith('m1', expect.objectContaining({ occurrence_id: OCCURRENCE_ID }));
    });

    it('scopes an uploaded file to the managed occurrence when "this occurrence" is chosen', async () => {
      const { component, meetingService } = await mount({ occurrence });
      component.setNewItemScope('occurrence');
      component.onFileSelect({ files: [pdf('notes.pdf')] });

      component.onSave();

      expect(meetingService.uploadMeetingFile).toHaveBeenCalledWith('m1', expect.any(File), expect.objectContaining({ occurrence_id: OCCURRENCE_ID }));
    });

    it('keeps the scope a file was queued with when the picker changes afterwards', async () => {
      const { component, meetingService } = await mount({ occurrence });
      component.setNewItemScope('occurrence');
      component.onFileSelect({ files: [pdf('notes.pdf')] });
      component.setNewItemScope('series');
      component.onFileSelect({ files: [pdf('agenda.pdf')] });

      component.onSave();

      const scopeByName = new Map(meetingService.uploadMeetingFile.mock.calls.map(([, , presign]) => [presign.name, presign.occurrence_id]));
      expect(scopeByName.get('notes.pdf')).toBe(OCCURRENCE_ID);
      expect(scopeByName.get('agenda.pdf')).toBeUndefined();
    });

    it('does not scope anything without a scopable occurrence, even if the choice was left on "this occurrence"', async () => {
      const { component, meetingService } = await mount({ occurrence: null });
      component.setNewItemScope('occurrence');
      component.newLinkTitle.set('Repo');
      component.newLinkUrl.set('https://example.com/repo');

      component.addLink();

      expect(meetingService.createMeetingAttachment.mock.calls[0][1]).not.toHaveProperty('occurrence_id');
    });
  });

  describe("changing an existing attachment's scope", () => {
    it('stages the change without saving it, and flipping back clears it', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'series' })] });
      const series = component.linkAttachments()[0];

      component.toggleScope(series);
      expect(component.effectiveScope(series)).toBe('occurrence');
      expect(component.hasPendingChanges()).toBe(true);
      expect(meetingService.updateMeetingAttachment).not.toHaveBeenCalled();

      component.toggleScope(series);
      expect(component.effectiveScope(series)).toBe('series');
      expect(component.hasPendingChanges()).toBe(false);
    });

    it('saves a series-wide attachment as scoped to the managed occurrence, keeping its other fields', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'series', description: 'Weekly agenda' })] });
      component.toggleScope(component.linkAttachments()[0]);

      component.onSave();

      expect(meetingService.updateMeetingAttachment).toHaveBeenCalledWith('m1', 'series', {
        type: 'link',
        category: 'Other',
        name: 'Agenda',
        description: 'Weekly agenda',
        link: 'https://example.com/agenda',
        occurrence_id: OCCURRENCE_ID,
      });
      expect(component.effectiveScope(component.linkAttachments()[0])).toBe('occurrence');
      expect(component.pendingScopes().size).toBe(0);
    });

    it('saves a scoped attachment back to all occurrences by omitting occurrence_id', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'mine', occurrence_id: OCCURRENCE_ID })] });
      component.toggleScope(component.linkAttachments()[0]);

      component.onSave();

      expect(meetingService.updateMeetingAttachment.mock.calls[0][2]).not.toHaveProperty('occurrence_id');
      expect(component.effectiveScope(component.linkAttachments()[0])).toBe('series');
    });

    it('ignores a scope change made while a save is running', async () => {
      const { component } = await mount({ occurrence, attachments: [attachment({ uid: 'series' })] });
      component.saving.set(true);

      component.toggleScope(component.linkAttachments()[0]);

      expect(component.pendingScopes().size).toBe(0);
    });

    it('does not update an attachment that is also being deleted', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'series' })] });
      component.toggleScope(component.linkAttachments()[0]);
      component.markForDeletion('series');

      component.onSave();

      expect(meetingService.updateMeetingAttachment).not.toHaveBeenCalled();
      expect(meetingService.deleteMeetingAttachment).toHaveBeenCalledWith('m1', 'series');
    });

    it('keeps a failed scope change staged so it can be retried', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'series' })] });
      meetingService.updateMeetingAttachment.mockReturnValue(throwError(() => new Error('rejected')));
      component.toggleScope(component.linkAttachments()[0]);

      component.onSave();

      expect(component.pendingScopes().get('series')).toBe('occurrence');
      expect(component.visible()).toBe(true);
    });
  });

  describe('what is offered when the occurrence cannot take a scope', () => {
    const mine = attachment({ uid: 'mine', occurrence_id: OCCURRENCE_ID });

    it("still lists and labels the occurrence's attachments, but withholds the scope controls", async () => {
      const { component } = await mount({ occurrence, canScope: false, attachments: [mine, attachment({ uid: 'series' })] });

      expect(component.showScopes()).toBe(true);
      expect(component.canScope()).toBe(false);
      expect(component.linkAttachments().map((a) => a.uid)).toEqual(['mine', 'series']);
    });

    it('does not scope new materials even if the choice was left on "this occurrence"', async () => {
      const { component, meetingService } = await mount({ occurrence, canScope: false });
      component.setNewItemScope('occurrence');
      component.newLinkTitle.set('Repo');
      component.newLinkUrl.set('https://example.com/repo');

      component.addLink();

      expect(meetingService.createMeetingAttachment.mock.calls[0][1]).not.toHaveProperty('occurrence_id');
    });
  });

  describe("saving an attachment's scope", () => {
    it('never sends a scope change for an attachment created from the meeting description', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'desc', source: 'description' })] });
      component.pendingScopes.set(new Map([['desc', 'occurrence']]));

      component.onSave();

      expect(meetingService.updateMeetingAttachment).not.toHaveBeenCalled();
    });

    it('falls back to the Other category when the index returns an empty one', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'series', category: '' as never })] });
      component.toggleScope(component.linkAttachments()[0]);

      component.onSave();

      expect(meetingService.updateMeetingAttachment.mock.calls[0][2]).toEqual(expect.objectContaining({ category: 'Other' }));
    });
  });

  describe('retrying after a partial failure', () => {
    it('does not upload a file again once it has gone through', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'series' })] });
      meetingService.updateMeetingAttachment.mockReturnValue(throwError(() => new Error('rejected')));
      component.toggleScope(component.linkAttachments()[0]);
      component.pendingAttachments.set([{ id: 'p1', fileName: 'notes.pdf', file: new File(['x'], 'notes.pdf'), fileSize: 1, mimeType: 'application/pdf' }]);

      component.onSave();
      component.onSave();

      expect(meetingService.uploadMeetingFile).toHaveBeenCalledTimes(1);
      expect(component.pendingAttachments()).toEqual([]);
    });

    it('does not delete an attachment again once it has been deleted', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'series' }), attachment({ uid: 'other' })] });
      meetingService.updateMeetingAttachment.mockReturnValue(throwError(() => new Error('rejected')));
      component.toggleScope(component.linkAttachments()[1]);
      component.markForDeletion('series');

      component.onSave();
      component.onSave();

      expect(meetingService.deleteMeetingAttachment).toHaveBeenCalledTimes(1);
      expect(component.pendingDeletions().size).toBe(0);
      expect(component.linkAttachments().map((a) => a.uid)).toEqual(['other']);
    });

    it('does not retry a scope change on an attachment that was deleted', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'gone' }), attachment({ uid: 'other' })] });
      meetingService.updateMeetingAttachment.mockReturnValue(throwError(() => new Error('rejected')));
      component.toggleScope(component.linkAttachments()[0]);
      component.toggleScope(component.linkAttachments()[1]);
      component.markForDeletion('gone');

      component.onSave();
      component.onSave();

      expect(component.pendingScopes().has('gone')).toBe(false);
      expect(meetingService.updateMeetingAttachment.mock.calls.map(([, uid]) => uid)).toEqual(['other', 'other']);
    });

    it('lists a file that uploaded when the save only partly succeeded', async () => {
      const { component, meetingService } = await mount({ occurrence, attachments: [attachment({ uid: 'series' })] });
      meetingService.updateMeetingAttachment.mockReturnValue(throwError(() => new Error('rejected')));
      component.toggleScope(component.linkAttachments()[0]);
      component.onFileSelect({ files: [pdf('notes.pdf')] });

      component.onSave();

      expect(component.fileAttachments().map((a) => a.uid)).toEqual(['file-1']);
      expect(component.pendingAttachments()).toEqual([]);
    });

    it('keeps a file that failed to upload staged so the retry sends it', async () => {
      const { component, meetingService } = await mount({ occurrence });
      meetingService.uploadMeetingFile.mockReturnValue(throwError(() => new Error('s3 down')));
      component.pendingAttachments.set([{ id: 'p1', fileName: 'notes.pdf', file: new File(['x'], 'notes.pdf'), fileSize: 1, mimeType: 'application/pdf' }]);

      component.onSave();

      expect(component.pendingAttachments().map((a) => a.id)).toEqual(['p1']);
    });
  });
});
