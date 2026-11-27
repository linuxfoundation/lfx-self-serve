// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MEETING_TITLE_MAX_LENGTH, YOUTUBE_MAX_MEETING_TITLE_LENGTH } from '@lfx-one/shared/constants';
import { MeetingType, MeetingVisibility } from '@lfx-one/shared/enums';
import { Meeting, UserSearchResult } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../../meeting-composer-form.service';
import { ComposerDetailsAccessRedesignComponent } from './composer-details-access-redesign.component';

const JANE = { uid: 'u-1', first_name: 'Jane', last_name: 'Doe', email: 'jane@acme-motors.example', username: 'jdoe' } as UserSearchResult;

describe('ComposerDetailsAccessRedesignComponent', () => {
  let fixture: ComponentFixture<ComposerDetailsAccessRedesignComponent>;
  let formService: MeetingComposerFormService;
  let searchUsers: ReturnType<typeof vi.fn>;

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function render(mode: 'create' | 'edit' = 'create', meeting: Partial<Meeting> = {}): Promise<void> {
    searchUsers = vi.fn().mockReturnValue(of([JANE]));
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        {
          provide: MeetingService,
          useValue: {
            getMeeting: vi.fn().mockReturnValue(of({ id: 'meeting-1', title: 'Saved', organizer: true, ...meeting } as Meeting)),
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getMeetingRegistrants: vi.fn().mockReturnValue(of([])),
          },
        },
        { provide: SearchService, useValue: { searchUsers } },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => null } },
      ],
    });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize(mode === 'edit' ? { mode, meetingUid: 'meeting-1' } : { mode });
    fixture = TestBed.createComponent(ComposerDetailsAccessRedesignComponent);
    fixture.componentRef.setInput('form', formService.form());
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => vi.useRealTimers());

  describe('title', () => {
    beforeEach(async () => render());

    it('caps the title at 150 characters, or at the YouTube limit while uploads are on', () => {
      const input = (): HTMLInputElement => query('composer-title-input')!.querySelector('input')!;
      expect(input().maxLength).toBe(MEETING_TITLE_MAX_LENGTH);

      formService.form().get('youtube_upload_enabled')?.setValue(true);
      fixture.detectChanges();

      expect(input().maxLength).toBe(YOUTUBE_MAX_MEETING_TITLE_LENGTH);
      expect(query('composer-title-youtube-counter')?.textContent?.trim()).toBe(`0/${YOUTUBE_MAX_MEETING_TITLE_LENGTH}`);
    });

    it('names the 150-character cap when a stored title exceeds it without YouTube uploads', () => {
      const title = formService.form().get('title');
      title?.setValue('x'.repeat(MEETING_TITLE_MAX_LENGTH + 1));
      title?.markAsTouched();
      fixture.detectChanges();

      expect(query('composer-title-input')?.textContent).toContain(`Meeting title cannot exceed ${MEETING_TITLE_MAX_LENGTH} characters.`);
    });

    it('shows the required error once the title is touched', () => {
      expect(query('composer-title-input')?.textContent).not.toContain('Meeting title is required');

      formService.form().get('title')?.markAsTouched();
      fixture.detectChanges();

      expect(query('composer-title-input')?.textContent).toContain('Meeting title is required');
    });
  });

  describe('type and access', () => {
    beforeEach(async () => render());

    it('lists the meeting types and flags a touched empty type', () => {
      expect(query('composer-meeting-type-select')).not.toBeNull();

      formService.form().get('meeting_type')?.markAsTouched();
      fixture.detectChanges();

      expect(query('composer-meeting-type-select')?.textContent).toContain('Meeting type is required');
    });

    it('hides type and access fields when the host turns them off', () => {
      fixture.componentRef.setInput('showTypeSelect', false);
      fixture.componentRef.setInput('showAccess', false);
      fixture.detectChanges();

      expect(query('composer-meeting-type-select')).toBeNull();
      expect(query('composer-visibility-group')).toBeNull();
      expect(query('composer-restricted-group')).toBeNull();
    });

    it('writes the join restriction back as a boolean and marks it dirty', () => {
      const anyone = query('composer-restricted-false')!.querySelector('input')!;
      anyone.click();
      fixture.detectChanges();

      expect(formService.form().get('restricted')?.value).toBe(false);
      expect(formService.form().get('restricted')?.dirty).toBe(true);
    });

    it('reflects the Board default of private and invited guests only', () => {
      formService.form().get('meeting_type')?.setValue(MeetingType.BOARD);
      fixture.detectChanges();

      const checked = (testId: string): boolean => (query(testId)!.querySelector('input') as HTMLInputElement).checked;
      expect(formService.form().get('visibility')?.value).toBe(MeetingVisibility.PRIVATE);
      expect(checked(`composer-visibility-${MeetingVisibility.PRIVATE}`)).toBe(true);
      expect(checked('composer-restricted-true')).toBe(true);
    });
  });

  describe('organizer', () => {
    it('searches the directory, then shows the picked person as a removable chip', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      await render();

      const search = query('composer-organizer-search')!.querySelector('input') as HTMLInputElement;
      search.value = 'ja';
      search.dispatchEvent(new Event('input'));
      TestBed.tick();
      vi.advanceTimersByTime(250);
      expect(searchUsers).toHaveBeenCalledWith('ja', 'committee_member');

      fixture.detectChanges();
      (document.querySelector('[data-testid="composer-organizer-option-u-1"]') as HTMLElement).click();
      fixture.detectChanges();

      const form = formService.form();
      expect(form.get('ownerName')?.value).toBe('Jane Doe');
      expect(form.get('ownerEmail')?.value).toBe(JANE.email);
      expect(form.get('ownerUsername')?.value).toBe('jdoe');
      expect(query('composer-organizer-chip')?.textContent).toContain('Jane Doe');

      (query('composer-organizer-remove')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(form.get('ownerEmail')?.value).toBeNull();
      expect(query('composer-organizer-chip')).toBeNull();
      expect(query('composer-organizer-search')).not.toBeNull();
      expect(query('composer-organizer-hint')?.textContent).toContain('Defaults to the meeting creator.');
    });

    it('stays in the searching state when a new search replaces a pending one', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      await render();
      const pending = new Subject<UserSearchResult[]>();
      searchUsers.mockReturnValue(pending);
      const component = fixture.componentInstance;
      const search = query('composer-organizer-search')!.querySelector('input') as HTMLInputElement;

      search.value = 'ja';
      search.dispatchEvent(new Event('input'));
      TestBed.tick();
      vi.advanceTimersByTime(250);
      expect(component['organizerLoading']()).toBe(true);

      search.value = 'jan';
      search.dispatchEvent(new Event('input'));
      TestBed.tick();
      vi.advanceTimersByTime(250);
      expect(searchUsers).toHaveBeenCalledTimes(2);
      expect(component['organizerLoading']()).toBe(true);

      pending.next([JANE]);
      pending.complete();
      expect(component['organizerLoading']()).toBe(false);
    });

    it('keeps the stored organizer when edit clears the chip', async () => {
      await render('edit', { owner: { username: 'kept', name: 'Kept Owner', email: 'kept@acme-motors.example' } } as Partial<Meeting>);

      expect(query('composer-organizer-hint')?.textContent).toContain('Leave empty to keep the current organizer.');
      expect(query('composer-organizer-chip')?.textContent).toContain('Kept Owner');

      (query('composer-organizer-remove')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(query('composer-organizer-search')).not.toBeNull();
      expect(formService.form().get('ownerUsername')?.value).toBe('kept');
    });
  });
});
