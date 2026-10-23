// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { Location } from '@angular/common';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import {
  LINKEDIN_FILE_ACCEPT,
  LINKEDIN_FILE_TYPES_LABEL,
  LINKEDIN_POST_INTAKE,
  LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY,
  LINKEDIN_PROFILE_MAX_FIELD_CHARS,
  LINKEDIN_SOURCE_MAX_BYTES,
  MKTG_KIT_FAMILIES,
  MKTG_RUN_FAILURE_REASON,
} from '@lfx-one/shared/constants';
import { LinkedinEnvelope, LinkedinResult, MktgLastIntake, ProjectContext } from '@lfx-one/shared/interfaces';
import { linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from '@lfx-one/shared/utils';
import { LinkedinPostService } from '@services/linkedin-post.service';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinPostRunComponent } from './linkedin-post-run.component';

describe('LinkedIn profile and post surface', () => {
  const profile = linkedinProfileFromSetup({ name: 'Example author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' });
  function envelope(): LinkedinEnvelope {
    return {
      contract: 'linkedin-post-output/v1',
      kind: 'linkedin-post',
      version: 2,
      profile,
      profile_markdown: renderLinkedinProfileMarkdown(profile),
      profile_source: 'saved_profile',
      profile_update_note: 'A more direct voice.',
      notes: ['Verify handles.'],
      options: [1, 2, 3].map((number) => ({
        number,
        label: `Angle ${number}`,
        text: `Example post ${number}. [LINK]`,
        word_count: 5,
        hashtags: ['#Code', '#Release', '#Community'],
        tagging_suggestions: ['Example project'],
      })),
      document_markdown: 'Example options',
      content_sha256: 'a'.repeat(64),
      inputs: { content_source: 'text', feedback_provided: true },
      generated_at: '2026-10-15T10:00:00Z',
      agent: { identifier: 'linux-foundation~linkedin-post', agent_version: '1.0.0', prompt_manifest_sha256: 'b'.repeat(64) },
    };
  }
  const context = signal<ProjectContext | null>({ uid: 'project-one', slug: 'example-project', name: 'Example project' });
  const api = { profile: vi.fn(), save: vi.fn(), start: vi.fn(), wait: vi.fn(), pending: vi.fn(), rememberShareLink: vi.fn(), answer: vi.fn() };
  const projects = { getProject: vi.fn() };
  const history = { lastIntake: vi.fn() };
  const identity = signal<{ sub: string; name: string } | null>({ sub: 'subject-one', name: 'Example author' });
  let clipboardDescriptor: PropertyDescriptor | undefined;
  const documents = { saveLinkedinShareLink: vi.fn() };
  beforeEach(async () => {
    vi.clearAllMocks();
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    identity.set({ sub: 'subject-one', name: 'Example author' });
    projects.getProject.mockReset().mockReturnValue(of({ writer: true }));
    api.pending.mockReset().mockReturnValue(null);
    history.lastIntake.mockReset().mockReturnValue(of(null));
    api.start.mockReset();
    api.wait.mockReset();
    api.answer.mockReset().mockReturnValue(of({ success: true }));
    context.set({ uid: 'project-one', slug: 'example-project', name: 'Example project' });
    documents.saveLinkedinShareLink.mockReset().mockImplementation((_project: string, _id: string, link: string) => of({ share_link: link }));
    api.profile.mockReturnValue(of({ profile: null }));
    api.save.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    await TestBed.configureTestingModule({
      imports: [LinkedinPostRunComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: LinkedinPostService, useValue: api },
        { provide: MktgAgentRunService, useValue: history },
        { provide: MktgDocumentStoreService, useValue: documents },
        { provide: ProjectContextService, useValue: { activeContext: context, activeContextUid: () => context()?.uid } },
        { provide: ProjectService, useValue: projects },
        { provide: UserService, useValue: { user: identity } },
      ],
    }).compileComponents();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });
  async function render() {
    const fixture = TestBed.createComponent(LinkedinPostRunComponent);
    fixture.componentRef.setInput('intake', LINKEDIN_POST_INTAKE);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  async function fresh() {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/linkedin-post?project=example-project&mode=new');
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    return render();
  }
  it.each([
    { source: 'text', text: 'Synthetic previous text', url: '' },
    { source: 'url', text: '', url: 'https://source.example/' },
    { source: 'file', text: '', url: '' },
  ])('restores $source last inputs only in fresh mode, without polling or generating', async ({ source, text, url }) => {
    history.lastIntake.mockReturnValue(
      of({ answers: { content_source: source, content_text: text, content_url: url, share_link: '' }, documentCount: 0, logoCount: 0 })
    );
    const fixture = await fresh();
    expect(history.lastIntake).toHaveBeenCalledWith('project-one', 'linkedin-post');
    expect(fixture.componentInstance['source']()).toBe(source);
    expect(fixture.componentInstance['contentForm'].getRawValue()).toMatchObject({ text, url, share_link: '' });
    expect(api.pending).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
    expect(api.wait).not.toHaveBeenCalled();
    if (source === 'file') expect(fixture.nativeElement.textContent).toContain('choose it again');
  });
  it('does not request last inputs on a normal entry', async () => {
    await render();
    expect(history.lastIntake).not.toHaveBeenCalled();
  });
  it.each([403, 503])('distinguishes denied and unavailable history (%s)', async (status) => {
    history.lastIntake.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    const fixture = await fresh();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-intake-note"]')?.textContent).toContain(
      status === 403 ? 'You need write access' : 'Last run inputs could not be loaded'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-draft"] button')?.disabled).toBe(status === 403);
  });
  it('keeps a user source choice made while last inputs are loading', async () => {
    const pending = new Subject<MktgLastIntake | null>();
    history.lastIntake.mockReturnValue(pending);
    const fixture = await fresh();
    fixture.componentInstance['onSource']('url');
    pending.next({ answers: { content_source: 'text', content_text: 'older source' }, documentCount: 0, logoCount: 0 });
    expect(fixture.componentInstance['source']()).toBe('url');
    expect(fixture.componentInstance['contentForm'].controls.text.value).toBe('');
  });
  it.each(['project', 'user'])('cancels stale source restoration when %s access changes', async (scope) => {
    const pending = new Subject<MktgLastIntake | null>();
    history.lastIntake.mockReturnValue(pending);
    const fixture = await fresh();
    projects.getProject.mockReturnValue(of({ writer: false }));
    if (scope === 'project') context.set({ uid: 'other-project', slug: 'other-project', name: 'Synthetic other project' });
    else identity.set({ sub: 'other-subject', name: 'Synthetic other author' });
    await fixture.whenStable();
    pending.next({ answers: { content_text: 'old-private-source' }, documentCount: 0, logoCount: 0 });
    expect(fixture.componentInstance['contentForm'].controls.text.value).toBe('');
    expect(history.lastIntake).toHaveBeenCalledTimes(1);
  });
  async function stored(link = '') {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['editing'].set(false);
    component['saved'].set({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    component['contentForm'].controls.share_link.setValue(link);
    component['run'].set({
      sessionId: 'synthetic-session',
      ownerToken: 'synthetic-token',
      documentId: 'run-0123456789abcdef01234567',
      answers: { share_link: link },
      source: { label: 'pasted text', words: 3, fetched: false },
    });
    component['complete'](envelope());
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  it('composes one breadcrumb with the main kit family route and catalog name', async () => {
    const fixture = await render();
    const family = MKTG_KIT_FAMILIES.find((family) => family.agentIds.includes(LINKEDIN_POST_INTAKE.agentId));
    if (!family) throw new Error('Expected a catalog family for the intake');
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(1);
    const link = element.querySelector('[data-testid="mktg-breadcrumb-link-1"]');
    expect(link?.textContent?.trim()).toBe(family.name);
    expect(link?.getAttribute('href')).toContain(`/families/${family.id}`);
  });
  it('uses fixed context parents on a shared run URL and the catalog agent title', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/linkedin-post?project=old&profile=edit&revision=old');
    const fixture = await render();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('[data-testid="mktg-breadcrumb-link-0"]')?.getAttribute('href')).toBe('/project/mktg-os-agents?project=example-project');
    expect(element.querySelector('[data-testid="mktg-breadcrumb-link-1"]')?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/families/social-community?project=example-project'
    );
    expect(element.querySelector('[aria-current="page"]')?.textContent).toBe('LinkedIn Post Agent');
  });
  it.each(['project', 'user'])('distinguishes a missing %s from a refused writer grant', async (missing) => {
    if (missing === 'project') context.set(null);
    else identity.set(null);
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-no-access"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-error"]').textContent).toContain(
      missing === 'project' ? 'Select a project' : 'Sign in'
    );
    expect(projects.getProject).not.toHaveBeenCalled();
  });
  it('reads writer access without changing the current project even if loading fails', async () => {
    projects.getProject.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const fixture = await render();
    expect(projects.getProject).toHaveBeenCalledWith('example-project', false);
    expect(context()?.uid).toBe('project-one');
    expect(fixture.componentInstance['error']()).toContain('could not be loaded');
  });
  it('keeps a selected file visible after editing, but clears it on a source switch', async () => {
    const fixture = await stored();
    const component = fixture.componentInstance;
    component['onSource']('file');
    component['file'].set(new File(['Release'], 'synthetic-release.txt'));
    component['onEdit']();
    component['onCancelEdit']();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-selected-file"]').textContent).toContain('synthetic-release.txt');
    component['onSource']('text');
    component['onSource']('file');
    fixture.detectChanges();
    expect(component['file']()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-selected-file"]')).toBeNull();
    await component['onDraft']();
    expect(component['error']()).toContain('Choose a text file');
    expect(api.start).not.toHaveBeenCalled();
  });
  it.each(['missing', 'oversized'])('uses the configured byte limit for a %s file without reading or starting a run', async (kind) => {
    const component = (await stored()).componentInstance;
    component['onSource']('file');
    if (kind === 'oversized') component['file'].set(new File([new Uint8Array(LINKEDIN_SOURCE_MAX_BYTES + 1)], 'synthetic.txt'));
    const read = (component['readFile'] = vi.fn());
    await component['onDraft']();
    expect(component['error']()).toBe(`Choose a text file up to ${LINKEDIN_SOURCE_MAX_BYTES.toLocaleString('en-US')} bytes.`);
    expect(read).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });
  it('opens explicit profile-edit navigation before recovering an unfinished run, resuming on cancel', async () => {
    api.profile.mockReturnValueOnce(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    api.pending.mockReturnValue({
      sessionId: 'pending-session',
      ownerToken: 'synthetic-token',
      documentId: 'run-0123456789abcdef01234567',
      source: { label: 'pasted text', words: 1, fetched: false },
    });
    vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.queryParamMap, 'get').mockImplementation((key) => (key === 'profile' ? 'edit' : null));
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    api.wait.mockReturnValue(new Subject<LinkedinResult>());
    const fixture = await render();
    expect(fixture.componentInstance['editing']()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-form"]')).not.toBeNull();
    expect(api.wait).not.toHaveBeenCalled();
    fixture.componentInstance['onCancelEdit']();
    expect(api.wait).toHaveBeenCalledOnce();
  });
  it.each([false, true])('renders an unsaved first-run result without claiming persistence (restored %s)', async (restored) => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['profileForm'].patchValue({ ...profile.about, ...profile.voice });
    component['onProfileSubmit']();
    const setup = component['setup']();
    if (restored) component['setup'].set(null);
    component['handleResult']({
      status: 'ready',
      envelope: {
        ...envelope(),
        version: 1,
        profile_source: 'first_run_setup',
        inputs: { content_source: 'text', feedback_provided: false },
        profile_update_note: undefined,
      },
      profileSaved: false,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component['saved']()).toBeNull();
    expect(component['setup']()).toEqual(setup);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-error"]').textContent).toContain('profile is not saved');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-results"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Profile saved for your next post');
    component['onEdit']();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-form"]')).not.toBeNull();
    api.save.mockReturnValueOnce(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    component['onProfileSubmit']();
    fixture.detectChanges();
    expect(api.save).toHaveBeenCalledWith({ setup });
    expect(api.start).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Profile saved for your next post');
  });
  it('confirms a first-run profile only after successful persistence', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['profileForm'].patchValue({ ...profile.about, ...profile.voice });
    component['onProfileSubmit']();
    component['handleResult']({ status: 'ready', envelope: { ...envelope(), profile_source: 'first_run_setup' }, profileSaved: true });
    fixture.detectChanges();
    expect(component['saved']()?.profile).toEqual(profile);
    expect(component['setup']()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Profile saved for your next post');
  });
  it('merges an offered voice into the freshly loaded profile without reverting About edits', async () => {
    const fixture = await stored();
    const current = { ...profile, about: { ...profile.about, name: 'Updated author', role: 'New role' } };
    const voice = { ...profile.voice, tone: 'Clear and direct' };
    const merged = { ...current, voice };
    fixture.componentInstance['result'].set({ ...envelope(), profile: { ...profile, voice } });
    api.profile.mockReturnValueOnce(of({ profile: { profile: current, profile_markdown: renderLinkedinProfileMarkdown(current) } }));
    api.save.mockReturnValueOnce(of({ profile: { profile: merged, profile_markdown: renderLinkedinProfileMarkdown(merged) } }));
    fixture.componentInstance['onSaveVoice']();
    expect(api.save).toHaveBeenCalledWith({ profile: merged });
    expect(fixture.componentInstance['saved']()?.profile.about).toEqual(current.about);
    expect(fixture.componentInstance['voiceSaved']()).toBe(true);
  });
  it('resets omitted optional fields when cancelled first-run profile edits reopen', async () => {
    const component = (await render()).componentInstance;
    component['profileForm'].patchValue({ name: 'Example author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' });
    component['onProfileSubmit']();
    component['onEdit']();
    component['profileForm'].patchValue({ tone: 'Cancelled tone' });
    component['onCancelEdit']();
    component['onEdit']();
    expect(component['profileForm'].get('tone')?.value).toBe('');
  });
  it('avoids nested landmarks and keeps the share-link live region mounted across saving and failure', async () => {
    const fixture = await stored();
    expect(fixture.nativeElement.querySelector('main, aside')).toBeNull();
    const status = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-share-status"]');
    expect(status).not.toBeNull();
    const pending = new Subject<{ share_link: string }>();
    documents.saveLinkedinShareLink.mockReturnValueOnce(pending);
    const field = fixture.componentInstance['contentForm'].controls.share_link;
    field.setValue('https://public.example/new');
    field.markAsDirty();
    fixture.componentInstance['onApplyShareLink']();
    fixture.detectChanges();
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-share-status"]')).toBe(status);
    pending.error(new HttpErrorResponse({ status: 503 }));
    fixture.detectChanges();
    expect(status.textContent).toBe('');
    expect(status.getAttribute('aria-busy')).toBe('false');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-share-status"]')).toBe(status);
  });

  it('Enter applies the share link without submitting or replacing the existing options', async () => {
    const fixture = await stored();
    const component = fixture.componentInstance;
    const original = component['result']();
    const input = fixture.nativeElement.querySelector('#linkedin-share-link');
    input.value = 'https://public.example/applied';
    input.dispatchEvent(new Event('input'));
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    await fixture.whenStable();
    expect(enter.defaultPrevented).toBe(true);
    expect(api.start).not.toHaveBeenCalled();
    expect(component['result']()).toBe(original);
    expect(documents.saveLinkedinShareLink).toHaveBeenCalledExactlyOnceWith('project-one', 'run-0123456789abcdef01234567', 'https://public.example/applied');
    expect(component['savedShareLink']()).toBe('https://public.example/applied');
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]').dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(api.start).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-draft"] button').type).toBe('button');
    const newline = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-content-text"] textarea').dispatchEvent(newline);
    expect(newline.defaultPrevented).toBe(false);
  });
  it('blur saves only changes for an existing post; invalid, unchanged and pre-draft values make no PATCH', async () => {
    const fixture = await stored('https://public.example/original');
    const component = fixture.componentInstance;
    component['onApplyShareLink']();
    expect(documents.saveLinkedinShareLink).not.toHaveBeenCalled();
    component['contentForm'].controls.share_link.setValue('javascript:bad');
    component['contentForm'].controls.share_link.markAsDirty();
    component['onApplyShareLink']();
    expect(component['linkError']()).toContain('HTTPS');
    expect(documents.saveLinkedinShareLink).not.toHaveBeenCalled();
    const input = fixture.nativeElement.querySelector('#linkedin-share-link');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await fixture.whenStable();
    expect(documents.saveLinkedinShareLink).toHaveBeenCalledWith('project-one', 'run-0123456789abcdef01234567', '');
    expect(component['savedShareLink']()).toBe('');
    expect(component['linkStatus']()).toBe('Link saved');
    expect(api.rememberShareLink).toHaveBeenCalledWith('project-one', expect.objectContaining({ answers: { share_link: '' } }), '');
    documents.saveLinkedinShareLink.mockClear();
    component['result'].set(null);
    component['contentForm'].controls.share_link.setValue('https://public.example/before-draft');
    component['onApplyShareLink']();
    expect(documents.saveLinkedinShareLink).not.toHaveBeenCalled();
  });
  it('keeps cards on the saved link until 2xx, leaves the field enabled, and waits before opening the document', async () => {
    const fixture = await stored('https://public.example/original');
    const component = fixture.componentInstance;
    const response = new Subject<{ share_link: string }>();
    documents.saveLinkedinShareLink.mockReturnValueOnce(response);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    component['contentForm'].controls.share_link.setValue('https://public.example/new');
    component['contentForm'].controls.share_link.markAsDirty();
    component['onApplyShareLink']();
    fixture.detectChanges();
    expect(component['linkStatus']()).toBe('Saving…');
    expect(fixture.nativeElement.querySelector('#linkedin-share-link').readOnly).toBe(false);
    expect(component['savedShareLink']()).toBe('https://public.example/original');
    component['onOpenDocument']();
    expect(navigate).not.toHaveBeenCalled();
    response.next({ share_link: 'https://public.example/new' });
    response.complete();
    await fixture.whenStable();
    expect(component['savedShareLink']()).toBe('https://public.example/new');
    expect(component['linkStatus']()).toBe('Link saved');
    expect(navigate).toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });
  it('keeps saved cards and inputs on save failure and never opens an unsaved document', async () => {
    const component = (await stored('https://public.example/original')).componentInstance;
    documents.saveLinkedinShareLink.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    component['contentForm'].controls.share_link.setValue('https://public.example/new');
    component['contentForm'].controls.share_link.markAsDirty();
    component['onOpenDocument']();
    expect(component['savedShareLink']()).toBe('https://public.example/original');
    expect(component['contentForm'].controls.share_link.value).toBe('https://public.example/new');
    expect(component['linkError']()).toBe('The link could not be saved. Your saved post is unchanged. Try again, or restore the saved link.');
    expect(component['linkSaving']()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(api.rememberShareLink).not.toHaveBeenCalled();
  });
  it.each(['none', 'failed', 'pending'] as const)(
    'drafts B with its auto-filled link, never PATCHes or waits on A; prior explicit save=%s',
    async (priorSave) => {
      const fixture = await stored('https://public.example/post-a');
      const component = fixture.componentInstance;
      const prior = new Subject<{ share_link: string }>();
      if (priorSave !== 'none') {
        documents.saveLinkedinShareLink.mockReturnValueOnce(priorSave === 'pending' ? prior : throwError(() => new HttpErrorResponse({ status: 503 })));
        component['contentForm'].controls.share_link.setValue('https://public.example/explicit-a');
        component['contentForm'].controls.share_link.markAsDirty();
        component['onApplyShareLink']();
        expect(documents.saveLinkedinShareLink).toHaveBeenCalledWith('project-one', 'run-0123456789abcdef01234567', 'https://public.example/explicit-a');
      }
      documents.saveLinkedinShareLink.mockClear();
      component['onSource']('url');
      component['contentForm'].controls.url.setValue('https://public.example/post-b');
      expect(component['contentForm'].controls.share_link.value).toBe('https://public.example/post-b');
      expect(component['contentForm'].controls.share_link.pristine).toBe(true);
      component['onApplyShareLink']();
      expect(documents.saveLinkedinShareLink).not.toHaveBeenCalled();
      api.start.mockReturnValueOnce(
        of({
          sessionId: 'session-b',
          ownerToken: 'token-b',
          documentId: 'run-abcdef0123456789abcdef01',
          source: { label: 'public source B', words: 3, fetched: true },
          answers: { share_link: 'https://public.example/post-b' },
        })
      );
      api.wait.mockReturnValueOnce(of({ status: 'ready', envelope: envelope() }));
      await component['onDraft']();
      await fixture.whenStable();
      expect(documents.saveLinkedinShareLink).not.toHaveBeenCalled();
      expect(api.start).toHaveBeenCalledExactlyOnceWith(
        LINKEDIN_POST_INTAKE,
        'project-one',
        expect.objectContaining({ content_url: 'https://public.example/post-b', share_link: 'https://public.example/post-b' }),
        undefined
      );
      expect(component['savedShareLink']()).toBe('https://public.example/post-b');
      if (priorSave === 'pending') {
        prior.next({ share_link: 'https://public.example/explicit-a' });
        prior.complete();
        expect(component['savedShareLink']()).toBe('https://public.example/post-b');
      }
      expect(component['linkSaving']()).toBe(false);
      expect(component['linkError']()).toBe('');
    }
  );
  it.each(['invalid-url', 'unreadable-file'] as const)('keeps A save serialized when Draft B fails: %s', async (failure) => {
    const component = (await stored('https://public.example/post-a')).componentInstance;
    const original = component['result']();
    const first = new Subject<{ share_link: string }>();
    const second = new Subject<{ share_link: string }>();
    documents.saveLinkedinShareLink.mockReturnValueOnce(first).mockReturnValueOnce(second);
    component['contentForm'].controls.share_link.setValue('https://public.example/first-a');
    component['contentForm'].controls.share_link.markAsDirty();
    component['onApplyShareLink']();
    component['onSource'](failure === 'invalid-url' ? 'url' : 'file');
    if (failure === 'unreadable-file') {
      component['file'].set(new File(['Synthetic source.'], 'synthetic.txt', { type: 'text/plain' }));
      component['readFile'] = vi.fn().mockRejectedValue(new Error('Synthetic file read refusal.'));
    }
    await component['onDraft']();
    expect(api.start).not.toHaveBeenCalled();
    expect(component['result']()).toBe(original);
    expect(component['linkSaving']()).toBe(true);
    expect(component['linkStatus']()).toBe('Saving…');
    expect(first.observed).toBe(true);
    component['contentForm'].controls.share_link.setValue('https://public.example/second-a');
    component['contentForm'].controls.share_link.markAsDirty();
    component['onApplyShareLink']();
    expect(documents.saveLinkedinShareLink).toHaveBeenCalledTimes(1);
    expect(second.observed).toBe(false);
    first.next({ share_link: 'https://public.example/first-a' });
    first.complete();
    expect(documents.saveLinkedinShareLink).toHaveBeenCalledTimes(2);
    expect(second.observed).toBe(true);
    second.next({ share_link: 'https://public.example/second-a' });
    second.complete();
    expect(component['savedShareLink']()).toBe('https://public.example/second-a');
  });
  it.each(['during-read', 'after-start'] as const)('does not carry A save errors into file draft B: %s', async (timing) => {
    const component = (await stored('https://public.example/post-a')).componentInstance;
    const save = new Subject<{ share_link: string }>();
    documents.saveLinkedinShareLink.mockReturnValueOnce(save);
    component['contentForm'].controls.share_link.setValue('https://public.example/explicit-a');
    component['contentForm'].controls.share_link.markAsDirty();
    component['onApplyShareLink']();
    component['onSource']('file');
    component['file'].set(new File(['Synthetic source.'], 'synthetic.txt', { type: 'text/plain' }));
    let finishRead: ((value: string) => void) | undefined;
    const reading = new Promise<string>((resolve) => {
      finishRead = resolve;
    });
    component['readFile'] = vi.fn(() => reading);
    api.start.mockReturnValueOnce(
      of({
        sessionId: 'session-b',
        ownerToken: 'token-b',
        documentId: 'run-abcdef0123456789abcdef01',
        source: { label: 'synthetic.txt', words: 2, fetched: false },
        answers: { share_link: '' },
      })
    );
    api.wait.mockReturnValueOnce(new Subject<LinkedinResult>());
    const drafting = component['onDraft']();
    expect(save.observed).toBe(true);
    expect(api.start).not.toHaveBeenCalled();
    if (timing === 'during-read') save.error(new HttpErrorResponse({ status: 503 }));
    if (!finishRead) throw new Error('Expected pending synthetic file read');
    finishRead('U3ludGhldGljIHNvdXJjZS4=');
    await drafting;
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(save.observed).toBe(false);
    if (timing === 'after-start') save.error(new HttpErrorResponse({ status: 503 }));
    expect(component['busy']()).toBe(true);
    expect(component['linkError']()).toBe('');
    expect(component['linkStatus']()).toBe('');
    expect(component['linkSaving']()).toBe(false);
  });
  it('completing a manually entered initial link resets dirty state for the next URL prefill', async () => {
    const component = (await stored('https://public.example/post-a')).componentInstance;
    component['contentForm'].controls.share_link.markAsDirty();
    component['complete'](envelope());
    expect(component['contentForm'].controls.share_link.pristine).toBe(true);
    component['onSource']('url');
    component['contentForm'].controls.url.setValue('https://public.example/post-b');
    expect(component['contentForm'].controls.share_link.value).toBe('https://public.example/post-b');
    expect(documents.saveLinkedinShareLink).not.toHaveBeenCalled();
  });
  it.each([true, false])('explicit dirty blur-save then Draft queues once; save succeeds=%s', async (succeeds) => {
    const fixture = await stored('https://public.example/original');
    const component = fixture.componentInstance;
    const original = component['result']();
    const save = new Subject<{ share_link: string }>();
    documents.saveLinkedinShareLink.mockReturnValueOnce(save);
    api.start.mockReturnValueOnce(
      of({
        sessionId: 'second-session',
        ownerToken: 'second-token',
        documentId: 'run-abcdef0123456789abcdef01',
        answers: { share_link: 'https://public.example/new' },
        source: { label: 'pasted text', words: 3, fetched: false },
      })
    );
    api.wait.mockReturnValueOnce(new Subject());
    component['contentForm'].controls.text.setValue('Synthetic next draft.');
    const input = fixture.nativeElement.querySelector('#linkedin-share-link');
    input.value = 'https://public.example/new';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-draft"] button');
    expect(button.disabled).toBe(false);
    button.click();
    button.click();
    expect(api.start).not.toHaveBeenCalled();
    expect(component['result']()).toBe(original);
    if (succeeds) {
      save.next({ share_link: 'https://public.example/new' });
      save.complete();
    } else save.error(new HttpErrorResponse({ status: 503 }));
    await fixture.whenStable();
    fixture.detectChanges();
    if (succeeds) expect(api.start).toHaveBeenCalledTimes(1);
    else {
      expect(api.start).not.toHaveBeenCalled();
      expect(component['result']()).toBe(original);
      expect(component['linkError']()).toContain('could not be saved');
      expect(button.disabled).toBe(false);
    }
  });

  it('serializes a later apply while saving and ignores completion after a project switch', async () => {
    const fixture = await stored();
    const component = fixture.componentInstance;
    const first = new Subject<{ share_link: string }>();
    const second = new Subject<{ share_link: string }>();
    documents.saveLinkedinShareLink.mockReturnValueOnce(first).mockReturnValueOnce(second);
    component['contentForm'].controls.share_link.setValue('https://public.example/first');
    component['contentForm'].controls.share_link.markAsDirty();
    component['onApplyShareLink']();
    component['contentForm'].controls.share_link.setValue('https://public.example/second');
    component['onApplyShareLink']();
    expect(documents.saveLinkedinShareLink).toHaveBeenCalledTimes(1);
    first.next({ share_link: 'https://public.example/first' });
    first.complete();
    expect(documents.saveLinkedinShareLink).toHaveBeenCalledTimes(2);
    expect(component['savedShareLink']()).toBe('https://public.example/first');
    context.set({ uid: 'project-two', slug: 'second-project', name: 'Another project' });
    fixture.detectChanges();
    await fixture.whenStable();
    second.next({ share_link: 'https://public.example/second' });
    second.complete();
    expect(component['savedShareLink']()).toBe('');
    expect(component['result']()).toBeNull();
  });

  it('collects first-run questions, keeps defaults optional and does not save before a run', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    expect(fixture.nativeElement.textContent).toContain('Their role (for personalization)');
    component['profileForm'].patchValue({ ...profile.about });
    component['onProfileSubmit']();
    fixture.detectChanges();
    expect(component['setup']()?.name).toBe('Example author');
    expect(api.save).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Regenerate with feedback');
  });
  it('renders configured limits/file types and stable testids on native controls', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    const name = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-name"] input');
    expect(name.maxLength).toBe(LINKEDIN_PROFILE_MAX_FIELD_CHARS);
    component['profileForm'].patchValue({ ...profile.about });
    component['onProfileSubmit']();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-content-text"] textarea')).not.toBeNull();
    component['onSource']('file');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-linkedin-file"]').length).toBe(1);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-file"] input[type="file"]').accept).toBe(LINKEDIN_FILE_ACCEPT);
    expect(fixture.nativeElement.textContent).toContain(LINKEDIN_FILE_TYPES_LABEL);
  });
  it('edits a saved profile prefilled, saving without creating a document', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const fixture = await render();
    const component = fixture.componentInstance;
    component['onEdit']();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-cancel-edit"] button').click();
    expect(component['editing']()).toBe(false);
    component['onEdit']();
    expect(component['profileForm'].getRawValue()['tone']).toBe(profile.voice.tone);
    component['profileForm'].controls['tone'].setValue('direct');
    component['onProfileSubmit']();
    expect(api.save).toHaveBeenCalledWith({ setup: expect.objectContaining({ tone: 'direct' }) });
    expect(api.start).not.toHaveBeenCalled();
  });
  it('opens the saved personal profile in edit mode from the document link without running an agent', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.queryParamMap, 'get').mockImplementation((key) => (key === 'profile' ? 'edit' : null));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await render();
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-form"]')).not.toBeNull();
    expect(fixture.componentInstance['profileForm'].controls['name'].value).toBe('Example author');
    expect(api.start).not.toHaveBeenCalled();
  });

  it('pushes profile editing, restores it from the URL, and cancels through browser history', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    const runUrl = '/project/mktg-os-agents/linkedin-post?project=example-project';
    await router.navigateByUrl(runUrl);
    const fixture = await render();
    fixture.componentInstance['onEdit']();
    await fixture.whenStable();
    expect(router.url).toContain('profile=edit');
    expect(fixture.componentInstance['editing']()).toBe(true);
    TestBed.inject(Location).back();
    await vi.waitFor(() => expect(router.url).toBe(runUrl));
    expect(fixture.componentInstance['editing']()).toBe(false);
    TestBed.inject(Location).forward();
    await vi.waitFor(() => expect(router.url).toContain('profile=edit'));
    expect(fixture.componentInstance['editing']()).toBe(true);
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    fixture.componentInstance['onCancelEdit']();
    expect(back).toHaveBeenCalledOnce();
  });

  it('saves an edit by returning to its pushed run entry, so the next Back leaves the run page', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    await router.navigateByUrl('/project/mktg-os-agents/families/social-community?project=example-project');
    const runUrl = '/project/mktg-os-agents/linkedin-post?project=example-project';
    await router.navigateByUrl(runUrl);
    const fixture = await render();
    const writes = vi.spyOn(router, 'navigate');
    fixture.componentInstance['onEdit']();
    await fixture.whenStable();
    expect(location.getState()).toMatchObject({ [LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY]: true });
    fixture.componentInstance['onProfileSubmit']();
    await vi.waitFor(() => expect(router.url).toBe(runUrl));
    await fixture.whenStable();
    expect(writes).toHaveBeenCalledOnce();
    location.back();
    await vi.waitFor(() => expect(router.url).toContain('/families/social-community'));
    await fixture.whenStable();
  });

  it.each(['cancel', 'save'] as const)('cold entry → Family → Back → %s clears profile in place', async (action) => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    const editUrl = '/project/mktg-os-agents/linkedin-post?project=example-project&profile=edit';
    await router.navigateByUrl(editUrl);
    let fixture = await render();
    await router.navigateByUrl('/project/mktg-os-agents/families/social-community?project=example-project');
    fixture.destroy();
    location.back();
    await vi.waitFor(() => expect(router.url).toBe(editUrl));
    fixture = await render();
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    const navigate = vi.spyOn(router, 'navigate');
    if (action === 'cancel') fixture.componentInstance['onCancelEdit']();
    else fixture.componentInstance['onProfileSubmit']();
    await fixture.whenStable();
    expect(back).not.toHaveBeenCalled();
    expect(router.url).toBe('/project/mktg-os-agents/linkedin-post?project=example-project');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true, queryParams: { profile: null, project: 'example-project' } }));
  });

  it.each(['cancel', 'save'] as const)('an in-app document hand-off returns to the document on %s', async (action) => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    router.setUpLocationChangeListener();
    const documentUrl = '/project/mktg-os-agents/documents/linkedin-post/synthetic?project=example-project';
    await router.navigateByUrl(documentUrl);
    await router.navigateByUrl('/project/mktg-os-agents/linkedin-post?project=example-project&profile=edit', {
      state: { [LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY]: true },
    });
    const fixture = await render();
    if (action === 'cancel') fixture.componentInstance['onCancelEdit']();
    else fixture.componentInstance['onProfileSubmit']();
    await vi.waitFor(() => expect(router.url).toBe(documentUrl));
    await fixture.whenStable();
  });

  it('keeps setup-only answers on intake after an edit pushed from a stored document', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/documents/linkedin-post/synthetic?project=example-project');
    await router.navigateByUrl('/project/mktg-os-agents/linkedin-post?project=example-project&profile=edit', {
      state: { [LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY]: true },
    });
    const fixture = await render();
    const component = fixture.componentInstance;
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    component['profileForm'].patchValue({ ...profile.about, ...profile.voice });
    component['onProfileSubmit']();
    await fixture.whenStable();
    expect(back).not.toHaveBeenCalled();
    expect(router.url).toBe('/project/mktg-os-agents/linkedin-post?project=example-project');
    expect(component['setup']()).toMatchObject({
      name: profile.about.name,
      role: profile.about.role,
      focus_areas: profile.about.focus_areas,
      primary_audience: profile.about.primary_audience,
    });
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).not.toBeNull();
    expect(api.save).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  it('loads a content source URL, pushes source switches and restores the prior source without another write', async () => {
    api.profile.mockReturnValue(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    const path = '/project/mktg-os-agents/linkedin-post?project=example-project';
    await router.navigateByUrl(`${path}&source=url`);
    const fixture = await render();
    expect(fixture.componentInstance['source']()).toBe('url');
    fixture.componentInstance['onSource']('file');
    await fixture.whenStable();
    expect(router.url).toContain('source=file');
    await router.navigateByUrl(`${path}&source=url`);
    await fixture.whenStable();
    expect(fixture.componentInstance['source']()).toBe('url');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-content-url"]')).not.toBeNull();
    expect(api.start).not.toHaveBeenCalled();
  });

  it('does not carry the profile-edit flag when opening the run document', async () => {
    const component = (await render()).componentInstance;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    component['run'].set({
      sessionId: 'synthetic-session',
      ownerToken: 'synthetic-token',
      documentId: 'run-0123456789abcdef01234567',
      source: { label: 'pasted text', words: 3, fetched: false },
    });
    component['onOpenDocument']();
    expect(navigate).toHaveBeenCalledWith(
      ['..', 'documents', LINKEDIN_POST_INTAKE.agentId, 'run-0123456789abcdef01234567'],
      expect.objectContaining({ queryParams: { profile: null }, queryParamsHandling: 'merge' })
    );
  });

  it('renders three options and separate notes, copies only post + hashtags, and saves a voice offer', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['editing'].set(false);
    component['saved'].set({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    component['result'].set(envelope());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-linkedin-option"]').length).toBe(3);
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
    const shareInput = fixture.nativeElement.querySelector('#linkedin-share-link');
    shareInput.scrollIntoView = vi.fn();
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-add-link"]').click();
    expect(document.activeElement).toBe(shareInput);
    expect(shareInput.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    const copyHost = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-copy-1"]');
    const copyButton = copyHost.querySelector('button');
    expect(copyHost.getAttribute('data-loading')).toBe('false');
    expect(copyButton.disabled).toBe(false);
    // A click dispatched to the wrapper host does not emit its onClick output.
    // The visible native button is the actual interactive target.
    copyHost.click();
    await fixture.whenStable();
    expect(clipboard).not.toHaveBeenCalled();
    expect(copyHost.textContent).toContain('Copy post');
    copyButton.click();
    await fixture.whenStable();
    expect(copyHost.textContent).toContain('Copied');
    expect(clipboard).toHaveBeenCalledWith('Example post 1. [LINK]\n\n#Code #Release #Community');
    expect(clipboard.mock.calls[0][0]).not.toContain('Verify handles');
    api.profile.mockReturnValueOnce(of({ profile: { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) } }));
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-save-voice"] button').click();
    expect(api.save).toHaveBeenCalledWith({ profile });
    expect(component['voiceSaved']()).toBe(true);
  });
  it('prefills the share link from the URL source, preserves an edit, and clears it for other sources', async () => {
    const component = (await render()).componentInstance;
    component['onSource']('url');
    component['contentForm'].controls.url.setValue('https://public.example/source');
    expect(component['contentForm'].controls.share_link.value).toBe('https://public.example/source');
    component['contentForm'].controls.share_link.setValue('https://public.example/shared');
    component['contentForm'].controls.share_link.markAsDirty();
    component['contentForm'].controls.url.setValue('https://public.example/another-source');
    expect(component['contentForm'].controls.share_link.value).toBe('https://public.example/shared');
    component['onSource']('text');
    expect(component['contentForm'].controls.share_link.value).toBe('');
    component['onSource']('file');
    expect(component['contentForm'].controls.share_link.value).toBe('');
  });
  it('clears first-run setup after completing a saved profile', async () => {
    const component = (await render()).componentInstance;
    component['setup'].set({ ...profile.about });
    component['complete'](
      {
        ...envelope(),
        version: 1,
        profile_source: 'first_run_setup',
        profile_update_note: undefined,
        inputs: { content_source: 'text', feedback_provided: false },
      },
      true
    );
    expect(component['setup']()).toBeNull();
    expect(component['saved']()?.profile).toEqual(profile);
  });
  it.each(['provider', 'idle'] as const)('shows %s failure with Retry and starts a new session using the unchanged inputs', async (kind) => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['editing'].set(false);
    component['saved'].set({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    const retryInputs = { answers: { content_source: 'text', content_text: 'Synthetic release notes', share_link: '' } };
    const run = {
      sessionId: 'dead-session',
      ownerToken: 'synthetic-token',
      documentId: 'run-0123456789abcdef01234567',
      source: { label: 'pasted text', words: 3, fetched: false },
      retryInputs,
    };
    component['run'].set(run);
    component['busy'].set(true);
    component['handleResult'](
      kind === 'provider'
        ? { status: 'failed', failure: { eventType: 'runtime_error', reason: 'The agent could not start. Your inputs are kept.' } }
        : { status: 'failed', failureText: 'Synthetic idle-runtime reply.' }
    );
    if (kind === 'idle') expect(component['error']()).toBe(MKTG_RUN_FAILURE_REASON);
    fixture.detectChanges();
    expect(component['busy']()).toBe(false);
    expect(component['result']()).toBeNull();
    for (const action of ['cancel', 'save'] as const) {
      component['onEdit']();
      await fixture.whenStable();
      if (action === 'cancel') component['onCancelEdit']();
      else component['onProfileSubmit']();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component['runFailed']()).toBe(true);
      expect(component['error']()).toBe(MKTG_RUN_FAILURE_REASON);
      expect(component['editing']()).toBe(false);
      expect(api.start).not.toHaveBeenCalled();
      expect(api.wait).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-retry-run"] button')?.textContent.trim()).toBe('Retry');
    }
    component['contentForm'].controls.text.setValue('');
    await component['onDraft']();
    fixture.detectChanges();
    expect(component['error']()).toContain('Supply pasted text');
    expect(component['runFailed']()).toBe(true);
    expect(component['run']()).toBe(run);
    expect(api.start).not.toHaveBeenCalled();
    expect(api.wait).not.toHaveBeenCalled();
    const retry = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-retry-run"] button');
    expect(retry.textContent.trim()).toBe('Retry');
    api.start.mockReturnValue(of({ ...run, sessionId: 'fresh-session' }));
    api.wait.mockReturnValue(NEVER);
    retry.click();
    expect(api.start).toHaveBeenCalledWith(LINKEDIN_POST_INTAKE, 'project-one', retryInputs.answers, undefined);
    expect(component['run']()?.sessionId).toBe('fresh-session');
    expect(api.wait.mock.calls.at(-1)?.[2].sessionId).toBe('fresh-session');
    component['handleResult']({ status: 'failed', failure: { eventType: 'runtime_error', reason: 'Synthetic session failure.' } });
    api.wait.mockClear();
    api.start.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    component['onRetryRun']();
    component['onRetryRun']();
    expect(component['runFailed']()).toBe(true);
    expect(api.wait).not.toHaveBeenCalled(); // A failed new-session POST never makes the dead session resumable again.
  });

  it.each(['file', 'text', 'url'] as const)('asks for a missing %s source after reload, never resumes the failed session', async (source) => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['saved'].set({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    component['editing'].set(false);
    component['run'].set({
      sessionId: 'dead-session',
      ownerToken: 'synthetic-proof',
      documentId: 'run-0123456789abcdef01234567',
      source: { label: 'source', words: 3, fetched: false },
      retryInputs: { answers: { content_source: source }, requiresSource: true },
    });
    component['handleResult']({ status: 'failed' });
    component['onRetryRun']();
    expect(component['source']()).toBe(source);
    expect(component['run']()).toBeNull();
    const prompts = { file: 'choose the file again', text: 'paste it again', url: 'enter the link again' };
    expect(component['error']()).toContain(prompts[source]);
    expect(api.start).not.toHaveBeenCalled();
    expect(api.wait).not.toHaveBeenCalled();
  });

  it('returns a reloaded failed first run to empty setup instead of polling the dead session', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['editing'].set(false);
    const answers = { content_source: 'text', content_text: 'Synthetic kept source.' };
    component['run'].set({
      sessionId: 'dead-first-run',
      ownerToken: 'synthetic-proof',
      documentId: 'run-0123456789abcdef01234567',
      source: { label: 'text', words: 3, fetched: false },
      retryInputs: { answers },
    });
    component['handleResult']({ status: 'failed', failure: { eventType: 'runtime_error', reason: 'Synthetic failed session.' } });
    component['onRetryRun']();
    fixture.detectChanges();
    expect(component['editing']()).toBe(true);
    expect(component['profileForm'].controls['name'].value).toBe('');
    expect(component['error']()).toBe("Your setup answers aren't kept in the browser — enter them again to draft");
    expect(api.wait).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
    component['profileForm'].patchValue(profile.about);
    component['onProfileSubmit']();
    api.start.mockReturnValue(of({ ...component['run'](), sessionId: 'fresh-first-run' }));
    api.wait.mockReturnValue(NEVER);
    component['onRetryRun']();
    expect(api.start).toHaveBeenCalledWith(LINKEDIN_POST_INTAKE, 'project-one', answers, expect.objectContaining(profile.about));
    expect(api.wait.mock.calls.at(-1)?.[2].sessionId).toBe('fresh-first-run');
  });

  it('exposes retry-run and Run-board breadcrumb controls through stable test ids', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['editing'].set(false);
    component['saved'].set({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    component['run'].set({
      sessionId: 'synthetic-session',
      ownerToken: 'synthetic-token',
      documentId: 'run-0123456789abcdef01234567',
      source: { label: 'Example source', words: 5, fetched: false },
    });
    component['error'].set('Synthetic failure');
    api.wait.mockReturnValue(of({ status: 'ready', envelope: envelope() }));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-retry-run"] button').click();
    expect(api.wait).toHaveBeenCalled();
    const crumb = fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-breadcrumb"]');
    expect(crumb.textContent).toContain('Example project kit');
    expect(crumb.textContent).toContain('Social & community');
    expect(crumb.textContent).toContain('LinkedIn');
    expect(crumb.querySelector('[data-testid="mktg-breadcrumb-link-0"]').tagName).toBe('A');
  });
  it('shows profile questions alone, sends answers on the same run and returns to three options', async () => {
    const fixture = await stored();
    const component = fixture.componentInstance;
    component['result'].set(null);
    component['handleResult']({
      status: 'questions',
      questionsId: 'a'.repeat(64),
      questionsProject: 'Example project',
      questions: [
        {
          key: 'tendency',
          label: 'Tendency',
          question: 'How direct should these posts sound?',
          why: 'This voice setting was skipped.',
          suggestedAnswer: 'Direct and practical, with a friendly tone.',
          basis: ['inferred'],
        },
      ],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-questions"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
    api.wait.mockReturnValueOnce(of({ status: 'ready', envelope: envelope() }));
    fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.answer).toHaveBeenCalledWith(LINKEDIN_POST_INTAKE, 'project-one', expect.objectContaining({ sessionId: 'synthetic-session' }), 'a'.repeat(64), [
      { key: 'tendency', text: 'Direct and practical, with a friendly tone.', origin: 'accepted' },
    ]);
    expect(component['run']()?.answeredQuestionsId).toBe('a'.repeat(64));
    expect(api.start).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-linkedin-option"]').length).toBe(3);
  });
  it('keeps a failed questions reply for retry instead of starting a fresh run', async () => {
    const fixture = await stored();
    const component = fixture.componentInstance;
    component['result'].set(null);
    component['handleResult']({
      status: 'questions',
      questionsId: 'a'.repeat(64),
      questions: [
        {
          key: 'tendency',
          label: 'Tendency',
          question: 'How direct should these posts sound?',
          why: 'Voice gap.',
          suggestedAnswer: 'Direct and practical, with a friendly tone.',
          basis: ['inferred'],
        },
      ],
    });
    api.answer.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    component['onAnswers']([{ key: 'tendency', text: 'A clear, technical voice for maintainers.', origin: 'edited' }]);
    expect(component['questions']()).toHaveLength(1);
    expect(component['previousAnswers']()).toEqual({ tendency: 'A clear, technical voice for maintainers.' });
    expect(component['error']()).toContain('kept');
    expect(api.start).not.toHaveBeenCalled();
  });
  it('shows the safe stale-question server message and keeps the edited answers', async () => {
    const component = (await stored()).componentInstance;
    component['result'].set(null);
    component['handleResult']({
      status: 'questions',
      questionsId: 'a'.repeat(64),
      questions: [
        {
          key: 'tendency',
          label: 'Tendency',
          question: 'How direct should these posts sound?',
          why: 'Voice gap.',
          suggestedAnswer: 'Direct and practical.',
          basis: ['inferred'],
        },
      ],
    });
    api.answer.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'These questions are no longer available. Reload the run.' } }))
    );
    component['onAnswers']([{ key: 'tendency', text: 'A clear technical voice.', origin: 'edited' }]);
    expect(component['error']()).toBe('These questions are no longer available. Reload the run.');
    expect(component['previousAnswers']()).toEqual({ tendency: 'A clear technical voice.' });
    expect(component['questions']()).toHaveLength(1);
    expect(api.start).not.toHaveBeenCalled();
  });
  it('uses main live activity with public progress and truthful URL guidance', async () => {
    const fixture = await stored();
    const component = fixture.componentInstance;
    component['result'].set(null);
    component['onSource']('url');
    api.wait.mockImplementation((_intake: unknown, _project: string, _run: unknown, progress?: (value: LinkedinResult) => void) => {
      progress?.({
        status: 'pending',
        activity: [{ id: 'reading', kind: 'reading', label: 'Reading the public source.', status: 'running', startedAt: '2026-10-19T10:00:00Z' }],
      });
      return new Subject<LinkedinResult>();
    });
    component['onRetryRun']();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-generating"]').textContent).toContain('Reading the public source.');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-source-hint"]').textContent).toContain(
      'Paste the public link; the agent reads the page.'
    );
    expect(fixture.nativeElement.textContent).not.toContain('cannot browse');
  });

  it('shows the BFF source refusal so the user knows to paste text instead', async () => {
    const fixture = await render();
    const component = fixture.componentInstance;
    component['editing'].set(false);
    component['contentForm'].controls.text.setValue('Example content');
    api.start.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              error: 'Validation failed for content',
              errors: [{ field: 'content', message: 'Could not fetch that public HTTPS page. Paste its text instead.' }],
            },
          })
      )
    );
    await component['onDraft']();
    expect(component['error']()).toContain('Paste its text instead.');
    expect(component['busy']()).toBe(false);
  });
  it('does not read the LinkedIn profile when project write access is denied', async () => {
    TestBed.overrideProvider(ProjectService, { useValue: { getProject: () => of({ writer: false }) } });
    const fixture = await render();
    expect(api.profile).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-no-access"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-post-form"]')).toBeNull();
  });
  it('renders a distinct load error, not an empty first-run profile', async () => {
    api.profile.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-retry-load"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-linkedin-profile-form"]')).toBeNull();
  });
});
