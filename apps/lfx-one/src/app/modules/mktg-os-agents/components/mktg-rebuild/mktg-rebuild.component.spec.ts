// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { MktgRebuildResponse } from '@lfx-one/shared/interfaces';
import { buildMktgRevisionKey } from '@lfx-one/shared/utils';
import { MktgRebuildService } from '@services/mktg-rebuild.service';
import { UserService } from '@services/user.service';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MktgRunActivityComponent } from '../../mktg-run-activity/mktg-run-activity.component';
import { MktgRebuildComponent } from './mktg-rebuild.component';

const framework = { agentKey: 'foundation-message' as const, revisionId: `000002-${'a'.repeat(64)}`, revisionNumber: 2, contentSha256: 'b'.repeat(64) };
const pending = (): MktgRebuildResponse => ({
  project: 'synthetic-project',
  chainId: 'chain',
  ownerToken: 'token',
  status: 'questions',
  framework,
  steps: [
    {
      agentId: 'boilerplates',
      agentKey: 'boilerplates',
      status: 'questions',
      activity: [],
      questionsId: 'q1',
      questions: [{ key: 'domain', label: 'Domain', question: 'Which domain?', why: 'Not found', suggestedAnswer: 'mesh.example', basis: [] }],
    },
  ],
});

describe('Family rebuild progress', () => {
  const impersonating = signal(false);
  const user = signal({ sub: 'synthetic-writer' });
  let fixture: ComponentFixture<MktgRebuildComponent>;
  let updates: Subject<MktgRebuildResponse>;
  let answers: Subject<MktgRebuildResponse>;
  let api: { run: ReturnType<typeof vi.fn>; answer: ReturnType<typeof vi.fn> };
  beforeEach(async () => {
    impersonating.set(false);
    user.set({ sub: 'synthetic-writer' });
    updates = new Subject();
    answers = new Subject();
    api = { run: vi.fn(() => updates), answer: vi.fn(() => answers) };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: MktgRebuildService, useValue: api }, { provide: UserService, useValue: { user, impersonating } }],
    });
    fixture = TestBed.createComponent(MktgRebuildComponent);
    fixture.componentRef.setInput('project', 'synthetic-project');
    fixture.componentRef.setInput('projectSlug', 'synthetic-slug');
    fixture.componentRef.setInput('projectName', 'Synthetic mesh');
    fixture.componentRef.setInput('framework', framework);
    fixture.componentRef.setInput('writer', true);
    await fixture.whenStable();
  });
  afterEach(() => vi.restoreAllMocks());
  it('resets elapsed time only when the running step changes, not on same-step progress', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    fixture.componentInstance.start();
    const chain = pending();
    chain.status = 'running';
    chain.steps[0] = { ...chain.steps[0], status: 'running', questions: undefined };
    updates.next(chain);
    await fixture.whenStable();
    const startedAt = () => fixture.debugElement.query(By.directive(MktgRunActivityComponent)).componentInstance.startedAt();
    expect(startedAt()).toBe(1000);
    now.mockReturnValue(361000);
    updates.next({ ...chain });
    await fixture.whenStable();
    expect(startedAt()).toBe(1000);
    updates.next({
      ...chain,
      steps: [
        { ...chain.steps[0], status: 'draft' },
        { agentId: 'faq', agentKey: 'faq', status: 'running', activity: [] },
      ],
    });
    await fixture.whenStable();
    expect(startedAt()).toBe(361000);
  });
  it('opens saved Drafts in a new tab during an active chain, with the switched project slug, without stopping progress', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?project=old-slug');
    fixture.componentRef.setInput('project', 'next-project');
    fixture.componentRef.setInput('projectSlug', 'next-slug');
    await fixture.whenStable();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fixture.componentInstance.start();
    const chain = pending();
    chain.status = 'running';
    chain.steps = [
      {
        ...chain.steps[0],
        status: 'draft',
        questions: undefined,
        persistence: {
          s3_key: buildMktgRevisionKey('next-project', 'boilerplates', 'living', 2, 'a'.repeat(64)),
          content_sha256: 'a'.repeat(64),
          project: 'next-project',
          version: 1,
        },
      },
      { agentId: 'faq', agentKey: 'faq', status: 'running', activity: [] },
    ];
    updates.next(chain);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="mktg-rebuild-open-boilerplates"] button');
    expect(button?.getAttribute('aria-label')).toBe('Open Draft in a new tab');
    button?.click();
    expect(open).toHaveBeenCalledWith(expect.stringContaining(`project=next-slug&revision=${framework.revisionId}`), '_blank', 'noopener,noreferrer');
    expect(router.url).toBe('/?project=old-slug');
    expect(updates.observed).toBe(true);
    updates.next({ ...chain, status: 'complete', steps: chain.steps.map((step) => ({ ...step, status: 'draft' })) });
    await fixture.whenStable();
    expect(fixture.componentInstance.chain()?.status).toBe('complete');
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    button?.click();
    expect(router.serializeUrl(navigate.mock.calls[0][0] as ReturnType<Router['createUrlTree']>)).toContain('project=next-slug');
    expect(open).toHaveBeenCalledOnce();
  });
  it('blocks without write evidence and during impersonation', async () => {
    fixture.componentRef.setInput('writer', false);
    await fixture.whenStable();
    fixture.componentInstance.start();
    expect(api.run).not.toHaveBeenCalled();
    fixture.componentRef.setInput('writer', true);
    impersonating.set(true);
    await fixture.whenStable();
    fixture.componentInstance.start();
    expect(api.run).not.toHaveBeenCalled();
    expect(fixture.componentInstance.canStart()).toBe(false);
  });
  it('shows the shared questions UI in place and answers via the same chain turn', async () => {
    fixture.componentInstance.start();
    updates.next(pending());
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-rebuild-status"]')?.textContent).toContain('paused');
    expect(root.querySelector('lfx-mktg-run-questions')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-testid="mktg-run-questions-send"] button')?.click();
    await fixture.whenStable();
    expect(api.answer).toHaveBeenCalledWith(pending(), 0, [{ key: 'domain', text: 'mesh.example', origin: 'accepted' }]);
    expect(fixture.componentInstance.active()).toBe(true);
    const completed = pending();
    completed.status = 'complete';
    completed.steps[0] = { ...completed.steps[0], status: 'draft', questions: undefined };
    answers.next(completed);
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="mktg-rebuild-status"]')?.textContent).toContain('ready for review');
  });
  it('retains earlier Drafts when a later step fails and surfaces transport errors', async () => {
    fixture.componentInstance.start();
    const stopped = pending();
    stopped.status = 'failed';
    stopped.steps = [
      { ...stopped.steps[0], status: 'draft', questions: undefined },
      { agentId: 'faq', agentKey: 'faq', status: 'failed', message: 'Source unavailable', activity: [] },
    ];
    updates.next(stopped);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Earlier Drafts are saved');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Source unavailable');
    updates.error(new Error('Progress unavailable'));
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="mktg-rebuild-error"]')?.textContent).toContain('Progress unavailable');
  });
  it('cancels old context subscriptions and drops capabilities on a project or subject change', async () => {
    fixture.componentInstance.start();
    updates.next(pending());
    fixture.componentRef.setInput('project', 'another-project');
    await fixture.whenStable();
    updates.next(pending());
    expect(fixture.componentInstance.chain()).toBeNull();
    expect(updates.observed).toBe(false);
  });
  it('autostarts a card action once only for its matching approved revision', async () => {
    fixture.componentRef.setInput('autoStartRevisionId', 'old-revision');
    await fixture.whenStable();
    expect(api.run).not.toHaveBeenCalled();
    fixture.componentRef.setInput('autoStartRevisionId', framework.revisionId);
    await fixture.whenStable();
    expect(api.run).toHaveBeenCalledOnce();
    updates.next(pending());
    await fixture.whenStable();
    expect(api.run).toHaveBeenCalledOnce();
  });
});
