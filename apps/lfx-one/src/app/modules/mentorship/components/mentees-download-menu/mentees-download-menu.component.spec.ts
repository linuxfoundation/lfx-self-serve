// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipAdminMenteeTab } from '@lfx-one/shared/interfaces';
import { MenuItem } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipMenteesExportService } from '../../services/mentorship-mentees-export.service';
import { MenteesDownloadMenuComponent } from './mentees-download-menu.component';

describe('MenteesDownloadMenuComponent', () => {
  const PROGRAM_ID = 'prog_1';
  const TEST_ID = 'mentorship-current-mentees-download';

  let fixture: ComponentFixture<MenteesDownloadMenuComponent>;
  let download: ReturnType<typeof vi.fn>;

  const create = (tab: MentorshipAdminMenteeTab) => {
    fixture = TestBed.createComponent(MenteesDownloadMenuComponent);
    fixture.componentRef.setInput('programId', PROGRAM_ID);
    fixture.componentRef.setInput('tab', tab);
    fixture.componentRef.setInput('dataTest', TEST_ID);
    fixture.detectChanges();
  };

  const menuItems = (): MenuItem[] => fixture.componentInstance['menuItems']();
  const button = () => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${TEST_ID}"]`)?.querySelector<HTMLButtonElement>('button') ?? null;

  beforeEach(() => {
    download = vi.fn().mockReturnValue(of(undefined));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteesDownloadMenuComponent],
      providers: [provideNoopAnimations(), { provide: MentorshipMenteesExportService, useValue: { download } }],
    });
  });

  it('offers All, then every Current Mentees status, in the filter order', () => {
    create('current');

    expect(menuItems().map((item) => item.label)).toEqual(['All', 'Applied', 'Tasks Completed', 'Accepted', 'Declined', 'Withdrawn', 'Graduated']);
  });

  it('offers All, then every Past Mentees wire status, in the filter order', () => {
    create('past');

    expect(menuItems().map((item) => item.label)).toEqual(['All', 'Pending', 'Accepted', 'Declined', 'Withdrawn', 'Graduated']);
  });

  it('downloads the chosen status of its tab, or every status for All', () => {
    create('past');

    menuItems()[1].command!({});
    menuItems()[0].command!({});

    expect(download.mock.calls).toEqual([
      [PROGRAM_ID, 'past', 'pending'],
      [PROGRAM_ID, 'past', null],
    ]);
  });

  it('disables the button and ignores another entry until the download settles', () => {
    create('current');
    const pending = new Subject<void>();
    download.mockReturnValueOnce(pending);

    menuItems()[1].command!({});
    menuItems()[2].command!({});
    fixture.detectChanges();

    expect(download).toHaveBeenCalledTimes(1);
    expect(button()?.disabled).toBe(true);

    pending.complete();
    fixture.detectChanges();

    expect(button()?.disabled).toBe(false);
    menuItems()[2].command!({});
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('opens the menu on click without downloading', () => {
    create('current');

    button()?.click();
    fixture.detectChanges();

    expect(download).not.toHaveBeenCalled();
  });
});
