// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Event, NavigationCancel, NavigationCancellationCode, NavigationEnd, NavigationStart, RoutesRecognized } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { gateReplayRecording, redactRumEvent, shouldRecordReplay } from './datadog-rum.provider';

const ORIGIN = 'https://app.example.org';
const SECRET = 'SUPER_SECRET';

describe('shouldRecordReplay', () => {
  it('refuses a URL carrying any credential RUM redacts, and allows a clean one', () => {
    expect(shouldRecordReplay(`${ORIGIN}/meetings/m-1?password=${SECRET}`, ORIGIN)).toBe(false);
    expect(shouldRecordReplay(`/meetings/m-1?passcode=${SECRET}`, ORIGIN)).toBe(false);
    expect(shouldRecordReplay(`${ORIGIN}/invite?token=${SECRET}`, ORIGIN)).toBe(false);
    expect(shouldRecordReplay(`${ORIGIN}/gw/newsletters#access_token=${SECRET}`, ORIGIN)).toBe(false);
    expect(shouldRecordReplay(`${ORIGIN}/meetings/m-1?tab=a`, ORIGIN)).toBe(true);
    expect(shouldRecordReplay('/meetings/m-1', ORIGIN)).toBe(true);
  });

  it('refuses a credential whose value already reads as the redaction marker', () => {
    expect(shouldRecordReplay(`${ORIGIN}/meetings/m-1?password=redacted`, ORIGIN)).toBe(false);
    expect(shouldRecordReplay('/meetings/m-1?passcode=REDACTED', ORIGIN)).toBe(false);
    expect(shouldRecordReplay(`${ORIGIN}/invite?token=redacted`, ORIGIN)).toBe(false);
    expect(shouldRecordReplay(`${ORIGIN}/login?returnTo=${encodeURIComponent('/meetings/m-1?password=redacted')}`, ORIGIN)).toBe(false);
    expect(shouldRecordReplay(`${ORIGIN}/meetings/m-1?password=%72edacted`, ORIGIN)).toBe(false);
    expect(shouldRecordReplay(`${ORIGIN}/gw/newsletters#access_token=redacted`, ORIGIN)).toBe(false);
  });

  it('records a clean URL that merely mentions the redaction marker outside a credential', () => {
    expect(shouldRecordReplay(`${ORIGIN}/search?q=redacted`, ORIGIN)).toBe(true);
    expect(shouldRecordReplay('/documents/REDACTED-notes', ORIGIN)).toBe(true);
    expect(shouldRecordReplay(`${ORIGIN}/meetings/m-1?token=redacted`, ORIGIN)).toBe(true);
  });
});

/**
 * Drives `gateReplayRecording` with a fake router stream, popstate stream and replay controller.
 * `href` stands in for the address bar; each test moves it the way the browser or router would.
 */
describe('gateReplayRecording', () => {
  const setup = (initialHref: string) => {
    const routerEvents = new Subject<Event>();
    const popState = new Subject<void>();
    const replay = { startSessionReplayRecording: vi.fn(), stopSessionReplayRecording: vi.fn() };
    const state = { href: initialHref };
    const subscription = gateReplayRecording(routerEvents, popState, ORIGIN, replay, () => state.href);
    return { routerEvents, popState, replay, state, subscription };
  };
  const clean = `${ORIGIN}/meetings/m-1`;
  const credentialed = `${ORIGIN}/meetings/m-1?password=${SECRET}`;

  it('starts recording on a clean landing URL and not on a credentialed one', () => {
    expect(setup(clean).replay.startSessionReplayRecording).toHaveBeenCalledTimes(1);

    const { replay } = setup(credentialed);
    expect(replay.startSessionReplayRecording).not.toHaveBeenCalled();
    expect(replay.stopSessionReplayRecording).toHaveBeenCalledTimes(1);
  });

  it('stops on NavigationStart to a credentialed URL, before the address bar changes', () => {
    const { routerEvents, replay } = setup(clean);
    replay.startSessionReplayRecording.mockClear();

    routerEvents.next(new NavigationStart(1, `/meetings/m-1?password=${SECRET}`));

    expect(replay.stopSessionReplayRecording).toHaveBeenCalledTimes(1);
    expect(replay.startSessionReplayRecording).not.toHaveBeenCalled();
  });

  it('stops when a clean URL redirects to a credentialed one', () => {
    const { routerEvents, replay } = setup(clean);

    routerEvents.next(new NavigationStart(1, '/meetings/m-1/join'));
    expect(replay.stopSessionReplayRecording).not.toHaveBeenCalled();

    routerEvents.next(new RoutesRecognized(1, '/meetings/m-1/join', `/meetings/m-1?password=${SECRET}`, {} as never));
    expect(replay.stopSessionReplayRecording).toHaveBeenCalledTimes(1);
  });

  it('follows the URL actually shown once a navigation ends or is cancelled', () => {
    const { routerEvents, replay, state } = setup(credentialed);
    replay.stopSessionReplayRecording.mockClear();

    state.href = clean;
    routerEvents.next(new NavigationEnd(1, '/meetings/m-1', '/meetings/m-1'));
    expect(replay.startSessionReplayRecording).toHaveBeenCalledTimes(1);

    routerEvents.next(new NavigationStart(2, `/meetings/m-1?password=${SECRET}`));
    routerEvents.next(new NavigationCancel(2, `/meetings/m-1?password=${SECRET}`, 'guard', NavigationCancellationCode.GuardRejected));
    expect(replay.startSessionReplayRecording).toHaveBeenCalledTimes(2);
  });

  it('stops on a history traversal that lands on a credentialed URL', () => {
    const { popState, replay, state } = setup(clean);

    state.href = `${ORIGIN}/invite?token=${SECRET}`;
    popState.next();

    expect(replay.stopSessionReplayRecording).toHaveBeenCalledTimes(1);
  });

  it('does not start on a history traversal; only a settled navigation restarts recording', () => {
    const { popState, replay, state } = setup(credentialed);
    replay.stopSessionReplayRecording.mockClear();

    state.href = clean;
    popState.next();

    expect(replay.startSessionReplayRecording).not.toHaveBeenCalled();
    expect(replay.stopSessionReplayRecording).not.toHaveBeenCalled();
  });

  it('stops reacting once unsubscribed', () => {
    const { routerEvents, popState, replay, state, subscription } = setup(clean);
    replay.startSessionReplayRecording.mockClear();

    subscription.unsubscribe();
    state.href = credentialed;
    popState.next();
    routerEvents.next(new NavigationStart(1, `/meetings/m-1?password=${SECRET}`));

    expect(replay.stopSessionReplayRecording).not.toHaveBeenCalled();
  });
});

/**
 * Drives representative RUM events through the redaction the `beforeSend` hook applies, so a field
 * dropped from the hook, or sent through the wrong redactor, fails here rather than reaching
 * telemetry. The redactors themselves are covered in `auth-fragment.utils.spec.ts`.
 */
describe('redactRumEvent', () => {
  it('redacts every credential from the URL fields of a view event', () => {
    const event = {
      type: 'view',
      view: {
        url: `${ORIGIN}/meetings/m-1?password=${SECRET}#access_token=${SECRET}`,
        referrer: `${ORIGIN}/invite?token=${SECRET}`,
        performance: { lcp: { resource_url: `${ORIGIN}/meetings/m-1?passcode=${SECRET}` } },
      },
    };

    redactRumEvent(event, ORIGIN);

    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(event.view.url).toBe(`${ORIGIN}/meetings/m-1?password=redacted#redacted`);
    expect(event.view.referrer).toBe(`${ORIGIN}/invite?token=redacted`);
    expect(event.view.performance.lcp.resource_url).toBe(`${ORIGIN}/meetings/m-1?passcode=redacted`);
  });

  it('redacts a relative referrer and leaves it relative', () => {
    const event = { view: { url: `${ORIGIN}/meetings/m-1`, referrer: `/meetings/m-1?password=${SECRET}` } };

    redactRumEvent(event, ORIGIN);

    expect(event.view.referrer).toBe('/meetings/m-1?password=redacted');
  });

  it('redacts the URL of a resource event', () => {
    const event = { type: 'resource', resource: { url: `${ORIGIN}/meetings/m-1?password=${SECRET}` } };

    redactRumEvent(event, ORIGIN);

    expect(event.resource.url).toBe(`${ORIGIN}/meetings/m-1?password=redacted`);
  });

  it('redacts the resource URL, message and stack of an error event', () => {
    const event = {
      type: 'error',
      error: {
        resource: { url: `${ORIGIN}/public/api/meetings/m-1?password=${SECRET}` },
        message: `GET ${ORIGIN}/public/api/meetings/m-1?password=${SECRET} failed`,
        stack: `Error: boom\n    at f (${ORIGIN}/meetings/m-1?password=${SECRET}:10:5)`,
      },
    };

    redactRumEvent(event, ORIGIN);

    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(event.error.resource.url).toBe(`${ORIGIN}/public/api/meetings/m-1?password=redacted`);
    expect(event.error.message).toBe(`GET ${ORIGIN}/public/api/meetings/m-1?password=redacted failed`);
    expect(event.error.stack).toBe(`Error: boom\n    at f (${ORIGIN}/meetings/m-1?password=redacted:10:5)`);
  });

  it('redacts the source URL and invoker of every long-task script', () => {
    const event = {
      type: 'long_task',
      long_task: {
        scripts: [
          { source_url: `${ORIGIN}/meetings/m-1?password=${SECRET}`, invoker: `${ORIGIN}/meetings/m-1?passcode=${SECRET}` },
          { source_url: `${ORIGIN}/main.js` },
        ],
      },
    };

    redactRumEvent(event, ORIGIN);

    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(event.long_task.scripts[0].source_url).toBe(`${ORIGIN}/meetings/m-1?password=redacted`);
    expect(event.long_task.scripts[0].invoker).toBe(`${ORIGIN}/meetings/m-1?passcode=redacted`);
    expect(event.long_task.scripts[1].source_url).toBe(`${ORIGIN}/main.js`);
  });

  it('leaves an event without credentials, or without the redacted fields, unchanged', () => {
    const view = { view: { url: `${ORIGIN}/meetings/m-1?tab=a`, referrer: '' } };
    const action = { type: 'action', action: { target: { name: 'Join' } } };
    const before = JSON.stringify([view, action]);

    redactRumEvent(view, ORIGIN);
    redactRumEvent(action, ORIGIN);

    expect(JSON.stringify([view, action])).toBe(before);
  });
});
