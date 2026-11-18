// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, signal, TemplateRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CommitteeJoinApplication, MyCommittee, MyPendingApplication, UiToastConfig } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupsHomeStore } from '../../services/groups-home.store';

import { GroupApplicationsComponent } from './group-applications.component';

const application = (uid: string, extra: Partial<MyPendingApplication> = {}): MyPendingApplication => ({
  uid,
  committee_uid: `committee-${uid}`,
  committee_name: `Synthetic Group ${uid}`,
  applicant_email: 'applicant@synthetic.example',
  status: 'pending',
  message: `Synthetic message ${uid}`,
  created_at: '2026-09-30T12:00:00Z',
  is_foundation: false,
  project_slug: 'synthetic-project',
  project_name: 'Synthetic Project',
  project_logo_url: 'https://logos.example/synthetic.svg',
  ...extra,
});

describe('GroupApplicationsComponent', () => {
  let fixture: ComponentFixture<GroupApplicationsComponent>;
  let fallback: HTMLButtonElement;
  let applications: MyPendingApplication[];
  let groups: ReturnType<typeof signal<MyCommittee[]>>;
  let withdraw: ReturnType<typeof vi.fn<(committeeId: string, applicationId: string) => Observable<CommitteeJoinApplication>>>;
  let submit: ReturnType<typeof vi.fn<(committeeId: string, message?: string) => Observable<CommitteeJoinApplication>>>;
  let show: ReturnType<typeof vi.fn<(config: UiToastConfig) => { id: string; dismiss: () => void }>>;
  let openDrawer: ReturnType<typeof vi.fn>;
  let closeDrawer: ReturnType<typeof vi.fn<() => void>>;

  const byTestId = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
  const all = (testId: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const text = (element: Element | null | undefined): string => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const trigger = (): HTMLButtonElement | null => byTestId('groups-redesign-applications-button')?.querySelector('button') ?? null;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
  };
  const render = async (): Promise<void> => {
    fixture = TestBed.createComponent(GroupApplicationsComponent);
    fixture.componentRef.setInput('fallbackFocus', fallback);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  };
  const open = async (): Promise<void> => {
    trigger()?.click();
    await settle();
  };
  const withdrawRow = async (index: number): Promise<void> => {
    const button = all('groups-redesign-applications-row')[index].querySelector(
      '[data-testid="groups-redesign-applications-withdraw"] button'
    ) as HTMLButtonElement;
    button.focus();
    button.click();
    await settle();
  };

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
    fallback = document.body.appendChild(document.createElement('button'));
    applications = [application('a'), application('b')];
    groups = signal<MyCommittee[]>([]);
    withdraw = vi.fn((committeeId: string, applicationId: string) =>
      of({ ...application(applicationId), committee_uid: committeeId, status: 'withdrawn' } as CommitteeJoinApplication)
    );
    submit = vi.fn((committeeId: string) => of({ ...application('a'), committee_uid: committeeId } as CommitteeJoinApplication));
    show = vi.fn(() => ({ id: 'toast', dismiss: () => undefined }));
    closeDrawer = vi.fn<() => void>();
    // Renders the drawer template straight into the page; the uikit drawer has its own spec.
    openDrawer = vi.fn((template: TemplateRef<unknown>) => {
      const view = template.createEmbeddedView({});
      TestBed.inject(ApplicationRef).attachView(view);
      document.body.append(...view.rootNodes);
      const closed = new Subject<void>();
      return {
        closed,
        close: () => {
          closeDrawer();
          view.rootNodes.forEach((node: Node) => node.parentNode?.removeChild(node));
          view.destroy();
          closed.next();
          closed.complete();
        },
      };
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: CommitteeService,
          useValue: { getMyApplications: () => of(applications), withdrawApplication: withdraw, submitApplication: submit },
        },
        { provide: GroupsHomeStore, useValue: { groups } },
        { provide: UiDrawerService, useValue: { open: openDrawer } },
        { provide: UiToastService, useValue: { show } },
      ],
    });
  });

  afterEach(() => {
    fixture.destroy();
    fallback.remove();
    vi.restoreAllMocks();
  });

  it('is hidden without pending applications, and skips groups the viewer already belongs to', async () => {
    applications = [application('a')];
    groups.set([{ uid: 'committee-a' } as MyCommittee]);
    await render();

    expect(trigger()).toBeNull();
  });

  it('counts the applications and opens a 640px drawer with the count waiting for review', async () => {
    await render();

    expect(text(byTestId('groups-redesign-applications-count'))).toBe('2');
    expect(trigger()?.getAttribute('aria-label')).toBe('Pending applications (2)');
    await open();

    expect(openDrawer).toHaveBeenCalledWith(expect.any(TemplateRef), { width: 640, describedBy: true });
    expect(text(byTestId('ui-drawer-title'))).toBe('Pending applications');
    expect(text(byTestId('ui-drawer-subtitle'))).toBe('2 applications waiting for admin review');
  });

  it('shows the scope, a link to the group that closes the drawer, and the date applied', async () => {
    await render();
    await open();

    const row = all('groups-redesign-applications-row')[0];
    expect(text(row.querySelector('[data-testid="groups-redesign-applications-row-scope"]'))).toBe('Synthetic Project');
    expect(text(row.querySelector('[data-testid="groups-redesign-applications-row-applied"]'))).toBe('Applied Sep 30, 2026');
    const link = row.querySelector('[data-testid="groups-redesign-applications-row-name"]') as HTMLAnchorElement;
    expect(text(link)).toBe('Synthetic Group a');
    expect(link.getAttribute('href')).toBe('/project/groups/committee-a?project=synthetic-project');
    link.click();
    expect(closeDrawer).toHaveBeenCalled();
  });

  it('withdraws, hides the row and offers Undo, which applies again with the same message', async () => {
    await render();
    await open();
    await withdrawRow(0);

    expect(withdraw).toHaveBeenCalledWith('committee-a', 'a');
    expect(all('groups-redesign-applications-row')).toHaveLength(1);
    expect(text(byTestId('ui-drawer-subtitle'))).toBe('1 application waiting for admin review');
    const toast = show.mock.calls[0][0];
    expect(toast.message).toBe('Application withdrawn');

    toast.actions?.[0].run();
    await settle();
    expect(submit).toHaveBeenCalledWith('committee-a', 'Synthetic message a');
    expect(all('groups-redesign-applications-row')).toHaveLength(2);
  });

  it('puts the row back when withdrawing fails', async () => {
    withdraw.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render();
    await open();
    await withdrawRow(0);

    expect(all('groups-redesign-applications-row')).toHaveLength(2);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', message: "Couldn't withdraw the application" }));
  });

  it('keeps the row off when the application was already reviewed', async () => {
    withdraw.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    await render();
    await open();
    await withdrawRow(0);

    expect(all('groups-redesign-applications-row')).toHaveLength(1);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning', message: 'Application no longer pending' }));
  });

  it('closes the drawer with the last application and hands focus to the fallback', async () => {
    applications = [application('a')];
    await render();
    await open();
    await withdrawRow(0);

    expect(closeDrawer).toHaveBeenCalled();
    expect(trigger()).toBeNull();
    expect(document.activeElement).toBe(fallback);
  });
});
