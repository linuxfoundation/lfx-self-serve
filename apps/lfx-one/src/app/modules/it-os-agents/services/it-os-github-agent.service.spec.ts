// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ItOsAgentMessage } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItOsGithubAgentService } from './it-os-github-agent.service';

describe('ItOsGithubAgentService', () => {
  let service: ItOsGithubAgentService;

  const lastBot = (): ItOsAgentMessage => [...service.messages()].reverse().find((m) => !m.fromUser && !m.typing && !m.steps) as ItOsAgentMessage;
  const ask = (text: string): ItOsAgentMessage => {
    service.send(text);
    vi.runAllTimers();
    return lastBot();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ItOsGithubAgentService);
    service.reset();
  });

  afterEach(() => vi.useRealTimers());

  it('opens with the fix when thelinuxfoundation is a member but not an owner', () => {
    const greeting = service.messages()[0];

    expect(greeting.html).toContain('is a member of');
    expect(greeting.html).toContain('Change role');
    expect(greeting.actions?.[0].label).toBe("I've done it, check again");
  });

  it('confirms full connection after the user changes the role', () => {
    const reply = ask('check again');

    expect(reply.html).toContain('fully connected');
    expect(service.status()).toEqual({ ok: true, text: 'thelinuxfoundation is an owner' });
  });

  it('walks an uninvited org through invitation, then ownership', () => {
    service.setScenario('none');
    expect(service.messages()[0].html).toContain('Invite member');

    expect(ask("I've invited it").html).toContain('LF accepts it on its side');
    expect(ask('check again').html).toContain('fully connected');
  });

  it('explains a token policy that blocks LF even when it is an owner', () => {
    service.setScenario('pat');

    expect(service.messages()[0].html).toContain('requires personal access tokens to expire');
    expect(service.linked(service.orgs()[0])).toBe('partial');
  });

  it('connects another org without approval and then shows the invite steps', () => {
    const reply = ask('We have another org called example-foundation-labs');
    const change = reply.plan?.changes[0];

    expect(change?.payload).toEqual({ org: 'example-foundation-labs' });
    expect(change && service.needsApproval(change)).toBe(false);

    service.confirmPlan(reply);
    vi.runAllTimers();

    expect(service.orgs().map((o) => o.org)).toEqual(['example-foundation', 'example-foundation-labs']);
    expect(lastBot().html).toContain("isn't part of");
    expect(service.status().text).toBe('2 of 2 orgs need attention');
  });

  it('asks for the org name when the user only says there is another org', () => {
    expect(ask('We have another GitHub org').html).toContain("What's the other org's name");
    expect(ask('github.com/example-sandbox').plan?.changes[0].payload).toEqual({ org: 'example-sandbox' });
  });

  it("doesn't suggest asking why LF must be an owner, and says it's required when asked", () => {
    expect(service.suggestions().some((s) => /why/i.test(s))).toBe(false);
    expect(ask('Why does LF need to be an owner?').html).toContain("It's required, not optional.");
  });

  it('keeps repos and people out of scope for now', () => {
    expect(ask('Create a repo called community').html).toContain('IT OS will cover repos and people later');
  });
});
