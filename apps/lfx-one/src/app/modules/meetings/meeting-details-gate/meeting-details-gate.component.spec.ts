// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, Signal, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { describe, expect, it } from 'vitest';

import { MeetingDetailsGateComponent } from './meeting-details-gate.component';

// Stand-ins for the two real trees, matched by selector — this spec is about which branch renders,
// and pulling in the real pages would drag their whole dependency graphs in with them. They record
// their construction order because a zoneless `detectChanges()` flushes `afterNextRender` inside the
// same call, so the pre-latch DOM is never observable from the outside — the order in which the two
// branches mounted is what shows that v1 rendered first and v2 replaced it.
const mountOrder: string[] = [];

@Component({ selector: 'lfx-meeting-join', template: '<div data-testid="v1-stub"></div>' })
class MeetingJoinStubComponent {
  public constructor() {
    mountOrder.push('v1');
  }
}

@Component({ selector: 'lfx-meeting-details-v2', template: '<div data-testid="v2-stub"></div>' })
class MeetingDetailsV2StubComponent {
  public constructor() {
    mountOrder.push('v2');
  }
}

describe('MeetingDetailsGateComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsGateComponent>;

  async function create(authenticated: WritableSignal<boolean>, getBooleanFlag: (key: string, defaultValue: boolean) => Signal<boolean>): Promise<void> {
    mountOrder.length = 0;

    await TestBed.configureTestingModule({
      imports: [MeetingDetailsGateComponent],
      providers: [
        { provide: FeatureFlagService, useValue: { getBooleanFlag } },
        { provide: UserService, useValue: { authenticated } },
      ],
    })
      .overrideComponent(MeetingDetailsGateComponent, {
        set: { imports: [MeetingJoinStubComponent, MeetingDetailsV2StubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MeetingDetailsGateComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // What LaunchDarkly hands back once it has a value for the flag.
  function flagReadsAs(value: WritableSignal<boolean>): () => Signal<boolean> {
    return () => value;
  }

  // What `FeatureFlagService.getBooleanFlag` does while the provider has not initialized: it hands
  // back whatever default the caller passed, so this stub proves which default the gate asks for.
  function flagProviderNeverReady(_key: string, defaultValue: boolean): Signal<boolean> {
    return signal(defaultValue);
  }

  function rendered(): { v1: boolean; v2: boolean } {
    return {
      v1: fixture.nativeElement.querySelector('[data-testid="meeting-details-gate-v1"]') !== null,
      v2: fixture.nativeElement.querySelector('[data-testid="meeting-details-gate-v2"]') !== null,
    };
  }

  it('renders v1 when the flag is off for an authenticated viewer', async () => {
    await create(signal(true), flagReadsAs(signal(false)));

    expect(rendered()).toEqual({ v1: true, v2: false });
    expect(fixture.nativeElement.querySelector('[data-testid="v1-stub"]')).not.toBeNull();
  });

  it('fails closed to v1 when the flag provider never becomes ready', async () => {
    await create(signal(true), flagProviderNeverReady);

    expect(rendered()).toEqual({ v1: true, v2: false });
    expect(mountOrder).toEqual(['v1']);
  });

  it('mounts v1 first and swaps to v2 only after the hydration latch', async () => {
    await create(signal(true), flagReadsAs(signal(true)));

    // v1 is what the first render pass — the one SSR serializes and the browser hydrates — put in
    // the DOM; v2 constructing second is the post-latch swap, not a tree Angular had to reconcile.
    expect(mountOrder).toEqual(['v1', 'v2']);
    expect(rendered()).toEqual({ v1: false, v2: true });
    expect(fixture.nativeElement.querySelector('[data-testid="v2-stub"]')).not.toBeNull();
  });

  it('keeps an anonymous viewer on v1 even with the flag on', async () => {
    await create(signal(false), flagReadsAs(signal(true)));

    expect(rendered()).toEqual({ v1: true, v2: false });
    expect(mountOrder).toEqual(['v1']);
  });

  // `authenticated()` starts false and flips once the session resolves on the client, so the gate
  // has to react rather than decide once — otherwise a targeted viewer would be pinned to v1.
  it('swaps to v2 when the viewer authenticates after the first render', async () => {
    const authenticated = signal(false);
    await create(authenticated, flagReadsAs(signal(true)));

    expect(rendered()).toEqual({ v1: true, v2: false });

    authenticated.set(true);
    fixture.detectChanges();

    expect(rendered()).toEqual({ v1: false, v2: true });
  });

  it('falls back to v1 when the flag flips off after v2 has rendered', async () => {
    const v2Flag = signal(true);
    await create(signal(true), flagReadsAs(v2Flag));

    expect(rendered()).toEqual({ v1: false, v2: true });

    v2Flag.set(false);
    fixture.detectChanges();

    expect(rendered()).toEqual({ v1: true, v2: false });
  });
});
