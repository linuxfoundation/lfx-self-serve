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
  LINKEDIN_SOURCE_LINK_HINT,
  MKTG_KIT_FAMILIES,
} from '@lfx-one/shared/constants';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from '@lfx-one/shared/utils';
import { LinkedinPostService } from '@services/linkedin-post.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinPostRunComponent } from './linkedin-post-run.component';

describe('LinkedIn profile and post surface', () => {
  const profile = linkedinProfileFromSetup({ name: 'Example author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' });
  const context = signal<ProjectContext | null>({ uid: 'project-one', slug: 'example-project', name: 'Example project' });
  const api = { profile: vi.fn(), save: vi.fn(), start: vi.fn(), pending: vi.fn(), answer: vi.fn() };
  const projects = { getProject: vi.fn() };
  const identity = signal<{ sub: string; name: string } | null>({ sub: 'subject-one', name: 'Example author' });
  beforeEach(async () => {
    vi.clearAllMocks();
    identity.set({ sub: 'subject-one', name: 'Example author' });
    projects.getProject.mockReset().mockReturnValue(of({ writer: true }));
    api.pending.mockReset().mockReturnValue(null);
    api.start.mockReset();
    api.answer.mockReset().mockReturnValue(of({ success: true }));
    context.set({ uid: 'project-one', slug: 'example-project', name: 'Example project' });
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
        { provide: MktgDocumentStoreService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContext: context, activeContextUid: () => context()?.uid } },
        { provide: ProjectService, useValue: projects },
        { provide: UserService, useValue: { user: identity } },
      ],
    }).compileComponents();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
  });
  async function render() {
    const fixture = TestBed.createComponent(LinkedinPostRunComponent);
    fixture.componentRef.setInput('intake', LINKEDIN_POST_INTAKE);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  async function savedIntake() {
    const fixture = await render();
    fixture.componentInstance['editing'].set(false);
    fixture.componentInstance['saved'].set({ profile, profile_markdown: renderLinkedinProfileMarkdown(profile) });
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  async function questionsIntake() {
    const fixture = await savedIntake();
    const component = fixture.componentInstance;
    component['run'].set({
      sessionId: 'synthetic-session',
      ownerToken: 'synthetic-proof',
      documentId: 'run-' + 'a'.repeat(24),
      source: { label: 'pasted text', words: 3, fetched: false },
    });
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
    return fixture;
  }
  it('keeps intake submission explicit, textarea Enter editable, source guidance truthful and landmarks unnested', async () => {
    const fixture = await savedIntake();
    const element: HTMLElement = fixture.nativeElement;
    fixture.componentInstance['contentForm'].controls.text.setValue('Synthetic valid source.');
    const form = element.querySelector('[data-testid="mktg-linkedin-post-form"]');
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form?.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(element.querySelector<HTMLButtonElement>('[data-testid="mktg-linkedin-draft"] button')?.type).toBe('button');
    const shareEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    element.querySelector('#linkedin-share-link')?.dispatchEvent(shareEnter);
    expect(shareEnter.defaultPrevented).toBe(true);
    const textareaEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const textarea = element.querySelector('#linkedin-content-text');
    expect(textarea).not.toBeNull();
    textarea?.dispatchEvent(textareaEnter);
    expect(textareaEnter.defaultPrevented).toBe(false);
    fixture.componentInstance['onSource']('url');
    fixture.detectChanges();
    expect(element.querySelector('[data-testid="mktg-linkedin-source-hint"]')?.textContent).toContain(LINKEDIN_SOURCE_LINK_HINT);
    expect(element.textContent).not.toContain('cannot browse');
    expect(element.querySelector('main, aside')).toBeNull();
    expect(api.start).not.toHaveBeenCalled();
  });

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
    const fixture = await savedIntake();
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
    const component = (await savedIntake()).componentInstance;
    component['onSource']('file');
    if (kind === 'oversized') component['file'].set(new File([new Uint8Array(LINKEDIN_SOURCE_MAX_BYTES + 1)], 'synthetic.txt'));
    const read = (component['readFile'] = vi.fn());
    await component['onDraft']();
    expect(component['error']()).toBe(`Choose a text file up to ${LINKEDIN_SOURCE_MAX_BYTES.toLocaleString('en-US')} bytes.`);
    expect(read).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
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

  it('keeps a failed questions reply for retry instead of starting a fresh run', async () => {
    const component = (await questionsIntake()).componentInstance;
    api.answer.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    component['onAnswers']([{ key: 'tendency', text: 'A clear, technical voice for maintainers.', origin: 'edited' }]);
    expect(component['questions']()).toHaveLength(1);
    expect(component['previousAnswers']()).toEqual({ tendency: 'A clear, technical voice for maintainers.' });
    expect(component['error']()).toContain('kept');
    expect(api.start).not.toHaveBeenCalled();
  });
  it('shows the safe stale-question server message and keeps the edited answers', async () => {
    const component = (await questionsIntake()).componentInstance;
    api.answer.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'These questions are no longer available. Reload the run.' } }))
    );
    component['onAnswers']([{ key: 'tendency', text: 'A clear technical voice.', origin: 'edited' }]);
    expect(component['error']()).toBe('These questions are no longer available. Reload the run.');
    expect(component['previousAnswers']()).toEqual({ tendency: 'A clear technical voice.' });
    expect(component['questions']()).toHaveLength(1);
    expect(api.start).not.toHaveBeenCalled();
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
