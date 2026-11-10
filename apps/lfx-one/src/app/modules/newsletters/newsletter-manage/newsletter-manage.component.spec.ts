// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { Newsletter, NewsletterPublication } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { firstValueFrom, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterManageComponent } from './newsletter-manage.component';

const PUBLICATION: NewsletterPublication = {
  id: '11111111-1111-4111-8111-111111111111',
  project_uid: 'p-1',
  name: 'Weekly update',
  template_key: 'set-b',
  committee_uids: ['c-1'],
  implicit: false,
  created_by: 'tester',
  version: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

// A pilot project, so with the flag on the publication picker applies.
const CONTEXT = { uid: 'p-1', slug: 'agentic-ai-foundation', name: 'Example Foundation', logoUrl: 'logo.png' };

interface ManageApi {
  onPublicationChange: (publication: NewsletterPublication | null) => void;
  saveDraft: (isManual?: boolean) => Observable<unknown>;
  showPublicationPicker: () => boolean;
  lockedTemplateKey: () => string | null;
  senderName: () => string;
  replyToEmail: () => string;
  handleSaveError: (err: HttpErrorResponse, isManual: boolean) => Observable<null>;
  publicationLocked: () => boolean;
  publicationFormLosesWork: () => boolean;
  basicAllowed: () => boolean;
  blocksSwitchBlocked: () => boolean;
  selectedPublication: { (): NewsletterPublication | null; set: (value: NewsletterPublication | null) => void };
}

describe('NewsletterManageComponent publications (#4349)', () => {
  let flag: WritableSignal<boolean>;
  let context: WritableSignal<typeof CONTEXT>;
  let newsletterService: {
    createNewsletter: ReturnType<typeof vi.fn>;
    getNewsletter: ReturnType<typeof vi.fn>;
    getPublication: ReturnType<typeof vi.fn>;
    getRecipientCount: ReturnType<typeof vi.fn>;
  };
  let messageAdd: ReturnType<typeof vi.fn>;
  let committees: { uid: string; category: string }[];

  const newComponent = (params: Record<string, string> = {}): { component: NewsletterManageComponent; api: ManageApi } => {
    const paramMap = convertToParamMap(params);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { paramMap: of(paramMap), queryParamMap: of(convertToParamMap({})), snapshot: { paramMap, queryParamMap: convertToParamMap({}) }, parent: {} },
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(NewsletterManageComponent);
    return { component: fixture.componentInstance, api: fixture.componentInstance as unknown as ManageApi };
  };

  const fillDraft = (component: NewsletterManageComponent): void => {
    component.form.patchValue({ committeeUids: ['c-1'], subject: 'Weekly note', bodyHtml: '<p>Body</p>' });
  };

  beforeEach(() => {
    flag = signal(true);
    context = signal(CONTEXT);
    newsletterService = {
      createNewsletter: vi.fn(() => of({ id: 'n-1', version: 1, body_html: '<p>Body</p>' } as Newsletter)),
      getNewsletter: vi.fn(),
      getPublication: vi.fn(() => of(PUBLICATION)),
      getRecipientCount: vi.fn(() => of({ count: 1 })),
    };
    messageAdd = vi.fn();
    committees = [];
    TestBed.configureTestingModule({
      imports: [NewsletterManageComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: NewsletterService, useValue: newsletterService },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => flag } },
        { provide: CommitteeService, useValue: { getCommitteesByProjectOrThrow: () => of(committees) } },
        { provide: ProjectContextService, useValue: { activeContext: context, activeContextUid: signal('p-1') } },
        { provide: ProjectService, useValue: { getProjectStrict: () => of(null) } },
        { provide: UserService, useValue: { user: signal({ name: 'Test Editor', email: 'editor@example.com' }) } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    });
    TestBed.overrideComponent(NewsletterManageComponent, { set: { imports: [], template: '' } });
  });

  it('sends publication_uid on create when the flag is on', async () => {
    const { component, api } = newComponent();
    fillDraft(component);
    api.onPublicationChange({ ...PUBLICATION, template_key: undefined });

    await firstValueFrom(api.saveDraft(true));

    expect(newsletterService.createNewsletter.mock.calls[0][1].publication_uid).toBe(PUBLICATION.id);
  });

  it('adds nothing to the create request when the flag is off', async () => {
    flag.set(false);
    const { component, api } = newComponent();
    fillDraft(component);
    api.onPublicationChange({ ...PUBLICATION, template_key: undefined });

    await firstValueFrom(api.saveDraft(true));

    const request = newsletterService.createNewsletter.mock.calls[0][1];
    expect(Object.keys(request).sort()).toEqual(['body_html', 'body_layout', 'committee_uids', 'ed_reply_email', 'scheduled_at', 'subject']);
    expect(api.showPublicationPicker()).toBe(false);
  });

  it('omits publication_uid for a one-off newsletter with the flag on', async () => {
    const { component, api } = newComponent();
    fillDraft(component);

    await firstValueFrom(api.saveDraft(true));

    expect('publication_uid' in newsletterService.createNewsletter.mock.calls[0][1]).toBe(false);
  });

  it('locks the template set for a publication that has one, and clears a mismatched body', () => {
    const { component, api } = newComponent();
    fillDraft(component);
    api.onPublicationChange(PUBLICATION);

    expect(api.lockedTemplateKey()).toBe('set-b');
    expect(component.form.controls.bodyHtml.value).toBe('');
    expect(component.form.controls.bodyLayout.value).toBeNull();
  });

  it('takes the publication audience for an empty selection', () => {
    const { component, api } = newComponent();
    api.onPublicationChange(PUBLICATION);

    expect(component.form.controls.committeeUids.value).toEqual(['c-1']);
  });

  it('replaces an audience a previous publication filled in, and keeps one the author chose', () => {
    const { component, api } = newComponent();
    api.onPublicationChange(PUBLICATION);
    api.onPublicationChange({ ...PUBLICATION, id: 'pub-2', committee_uids: ['c-2'] });
    expect(component.form.controls.committeeUids.value).toEqual(['c-2']);

    api.onPublicationChange(null);
    expect(component.form.controls.committeeUids.value).toEqual([]);

    component.form.controls.committeeUids.setValue(['c-9']);
    api.onPublicationChange(PUBLICATION);
    expect(component.form.controls.committeeUids.value).toEqual(['c-9']);
  });

  it('keeps an edition on its own template set when its publication cannot be read', () => {
    newsletterService.getPublication.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    newsletterService.getNewsletter.mockReturnValue(
      of({
        id: 'n-1',
        version: 2,
        status: 'draft',
        committee_uids: [],
        publication_uid: PUBLICATION.id,
        body_layout: { wrapper_key: 'w', template_key: 'set-a', blocks: [] },
      } as unknown as Newsletter)
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(api.lockedTemplateKey()).toBe('set-a');
  });

  it('shows the publication sender details on the review', () => {
    const { api } = newComponent();
    api.onPublicationChange({ ...PUBLICATION, from_name: 'Editorial Team', reply_to_email: 'team@example.com' });

    expect(api.senderName()).toBe('Editorial Team');
    expect(api.replyToEmail()).toBe('team@example.com');
  });

  it('reads an opened edition’s publication', () => {
    newsletterService.getNewsletter.mockReturnValue(
      of({
        id: 'n-1',
        version: 2,
        status: 'draft',
        committee_uids: [],
        publication_uid: PUBLICATION.id,
        body_layout: { wrapper_key: 'w', template_key: 'set-b', blocks: [] },
      } as unknown as Newsletter)
    );
    const { api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(newsletterService.getPublication).toHaveBeenCalledWith('p-1', PUBLICATION.id);
    expect(api.lockedTemplateKey()).toBe('set-b');
  });

  it('applies an opened edition’s publication with the flag off, without showing the picker', () => {
    flag.set(false);
    newsletterService.getNewsletter.mockReturnValue(
      of({
        id: 'n-1',
        version: 2,
        status: 'draft',
        committee_uids: [],
        publication_uid: PUBLICATION.id,
        body_layout: { wrapper_key: 'w', template_key: 'set-b', blocks: [] },
      } as unknown as Newsletter)
    );
    const { api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(newsletterService.getPublication).toHaveBeenCalledWith('p-1', PUBLICATION.id);
    expect(api.lockedTemplateKey()).toBe('set-b');
    expect(api.showPublicationPicker()).toBe(false);
  });

  it('shows no reply-to when an opened edition’s publication cannot be read', () => {
    newsletterService.getPublication.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    newsletterService.getNewsletter.mockReturnValue(
      of({ id: 'n-1', version: 2, status: 'draft', committee_uids: [], publication_uid: PUBLICATION.id } as unknown as Newsletter)
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(api.replyToEmail()).toBe('');
  });

  it('does not read a publication for a one-off draft', () => {
    newsletterService.getNewsletter.mockReturnValue(of({ id: 'n-1', version: 2, status: 'draft', committee_uids: [] } as unknown as Newsletter));
    const { api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(newsletterService.getPublication).not.toHaveBeenCalled();
    expect(api.replyToEmail()).toBe('editor@example.com');
  });

  it('turns a template mismatch 400 into a clear message', async () => {
    const { api } = newComponent();
    const err = new HttpErrorResponse({
      status: 400,
      error: { error: 'invalid_request: body_layout template_key "a" does not match the publication\'s template_key "b"' },
    });

    await firstValueFrom(api.handleSaveError(err, true));

    expect(messageAdd.mock.calls[0][0].detail).toContain("publication's template set");
  });

  it('shows a failed-save error unchanged when it is not a publication 400', async () => {
    newsletterService.createNewsletter.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'boom' } })));
    const { component, api } = newComponent();
    fillDraft(component);

    await firstValueFrom(api.saveDraft(true));

    expect(messageAdd.mock.calls[0][0].detail).toBe('boom');
  });
  it('freezes the publication while the first save is in flight, and keeps the one it was saved under', () => {
    const response = new Subject<Newsletter>();
    newsletterService.createNewsletter.mockReturnValue(response);
    const { component, api } = newComponent();
    fillDraft(component);
    api.onPublicationChange({ ...PUBLICATION, template_key: undefined });

    api.saveDraft(true).subscribe();
    expect(api.publicationLocked()).toBe(true);
    api.onPublicationChange({ ...PUBLICATION, id: 'pub-2', name: 'Other', template_key: undefined });
    expect(api.selectedPublication()?.id).toBe(PUBLICATION.id);

    response.next({ id: 'n-1', version: 1, body_html: '<p>Body</p>', publication_uid: PUBLICATION.id } as Newsletter);
    response.complete();
    expect(component.isEditMode()).toBe(true);
    expect(api.selectedPublication()?.id).toBe(PUBLICATION.id);
  });

  it('never sends a publication from another project', async () => {
    const { component, api } = newComponent();
    fillDraft(component);
    api.selectedPublication.set({ ...PUBLICATION, project_uid: 'p-other' });

    await firstValueFrom(api.saveDraft(true));

    expect('publication_uid' in newsletterService.createNewsletter.mock.calls[0][1]).toBe(false);
  });

  it('warns before the publication form discards a schedule-only edit', () => {
    newsletterService.getNewsletter.mockReturnValue(
      of({ id: 'n-1', version: 2, status: 'draft', subject: '', body_html: '', committee_uids: [], publication_uid: PUBLICATION.id } as unknown as Newsletter)
    );
    const { component, api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(api.publicationFormLosesWork()).toBe(false);

    const future = new Date(Date.now() + 3 * 86_400_000);
    component.form.patchValue({ sendMode: 'schedule', scheduleDate: future, scheduleTime: '10:00 AM' });
    TestBed.tick();

    expect(component.scheduleAtIso()).not.toBeNull();
    expect(api.publicationFormLosesWork()).toBe(true);
  });

  it('does not warn for an opened edition whose saved schedule is unchanged', () => {
    const at = new Date(Date.now() + 3 * 86_400_000);
    at.setUTCSeconds(0, 0);
    newsletterService.getNewsletter.mockReturnValue(
      of({
        id: 'n-1',
        version: 2,
        status: 'draft',
        subject: '',
        body_html: '',
        committee_uids: [],
        publication_uid: PUBLICATION.id,
        // The service sends RFC 3339 with no fraction; scheduleAtIso() rebuilds it with milliseconds.
        scheduled_at: at.toISOString().replace('.000Z', 'Z'),
      } as unknown as Newsletter)
    );
    const { component, api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();

    expect(component.scheduleAtIso()).toBe(at.toISOString());
    expect(api.publicationFormLosesWork()).toBe(false);
  });

  it('keeps an opened edition on its own template set while its publication loads', () => {
    const lookup = new Subject<NewsletterPublication>();
    newsletterService.getPublication.mockReturnValue(lookup);
    newsletterService.getNewsletter.mockReturnValue(
      of({
        id: 'n-1',
        version: 2,
        status: 'draft',
        committee_uids: [],
        publication_uid: PUBLICATION.id,
        body_layout: { wrapper_key: 'w', template_key: 'set-a', blocks: [] },
      } as unknown as Newsletter)
    );
    const { api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(api.lockedTemplateKey()).toBe('set-a');

    lookup.next({ ...PUBLICATION, template_key: undefined });
    lookup.complete();
    expect(api.lockedTemplateKey()).toBeNull();
  });
  it('keeps Basic for an opened Basic edition of a templated publication until it gets a layout', () => {
    newsletterService.getNewsletter.mockReturnValue(
      of({
        id: 'n-1',
        version: 2,
        status: 'draft',
        committee_uids: [],
        body_html: '<p>Saved</p>',
        body_layout: null,
        publication_uid: PUBLICATION.id,
      } as unknown as Newsletter)
    );
    const { component, api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(newsletterService.getPublication).toHaveBeenCalled();
    // Blocks still uses the publication's set; only Basic stays available.
    expect(api.lockedTemplateKey()).toBe('set-b');
    expect(api.basicAllowed()).toBe(true);

    component.form.controls.bodyLayout.setValue({ wrapper_key: 'w', template_key: 'set-b', blocks: [] } as never);
    TestBed.tick();
    expect(api.basicAllowed()).toBe(false);
  });

  it('still replaces a publication audience after it was narrowed automatically', () => {
    committees = ['c-1', 'c-2', 'c-3'].map((uid) => ({ uid, category: 'Newsletter' }));
    const { component, api } = newComponent();
    TestBed.tick();
    api.onPublicationChange({ ...PUBLICATION, template_key: undefined, committee_uids: ['c-1', 'c-2'] });
    TestBed.tick();
    expect(component.form.controls.committeeUids.value).toEqual(['c-1']);

    api.onPublicationChange({ ...PUBLICATION, id: 'pub-2', template_key: undefined, committee_uids: ['c-3'] });
    expect(component.form.controls.committeeUids.value).toEqual(['c-3']);
  });

  it('keeps a Basic edition off Blocks while its publication loads or cannot be read', () => {
    const lookup = new Subject<NewsletterPublication>();
    newsletterService.getPublication.mockReturnValue(lookup);
    newsletterService.getNewsletter.mockReturnValue(
      of({
        id: 'n-1',
        version: 2,
        status: 'draft',
        committee_uids: [],
        body_html: '<p>Saved</p>',
        body_layout: null,
        publication_uid: PUBLICATION.id,
      } as unknown as Newsletter)
    );
    const { api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(api.blocksSwitchBlocked()).toBe(true);

    lookup.error(new HttpErrorResponse({ status: 503 }));
    TestBed.tick();
    expect(api.blocksSwitchBlocked()).toBe(true);
  });

  it('allows Blocks for a Basic edition once its publication has loaded', () => {
    newsletterService.getNewsletter.mockReturnValue(
      of({
        id: 'n-1',
        version: 2,
        status: 'draft',
        committee_uids: [],
        body_html: '<p>Saved</p>',
        body_layout: null,
        publication_uid: PUBLICATION.id,
      } as unknown as Newsletter)
    );
    const { api } = newComponent({ id: 'n-1', projectUid: 'p-1' });
    TestBed.tick();
    expect(api.blocksSwitchBlocked()).toBe(false);
  });

  it('clears a picked publication and warns when the flag turns off before the first save', async () => {
    const { component, api } = newComponent();
    TestBed.tick();
    fillDraft(component);
    api.onPublicationChange({ ...PUBLICATION, template_key: undefined });
    TestBed.tick();

    flag.set(false);
    TestBed.tick();

    expect(api.selectedPublication()).toBeNull();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Publications unavailable' }));
    await firstValueFrom(api.saveDraft(true));
    expect('publication_uid' in newsletterService.createNewsletter.mock.calls[0][1]).toBe(false);
  });

  it('does not clear a preselected publication when the flag starts off', () => {
    flag.set(false);
    const { api } = newComponent();
    api.selectedPublication.set(PUBLICATION);
    TestBed.tick();

    expect(api.selectedPublication()?.id).toBe(PUBLICATION.id);
    expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Publications unavailable' }));
  });

  it('does not warn about publications when a project switch closes the gate', () => {
    const { api } = newComponent();
    TestBed.tick();
    api.onPublicationChange({ ...PUBLICATION, template_key: undefined });
    TestBed.tick();

    context.set({ ...CONTEXT, slug: 'not-a-pilot-project' });
    TestBed.tick();

    expect(api.showPublicationPicker()).toBe(false);
    expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Publications unavailable' }));
  });
});
