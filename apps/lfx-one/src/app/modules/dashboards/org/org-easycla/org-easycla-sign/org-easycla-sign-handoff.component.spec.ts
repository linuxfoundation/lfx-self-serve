// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CCLA_SIGN_COPY, ORG_CLA_SIGNED_SIGNATURE_KEY } from '@lfx-one/shared/constants';
import type { OrgClaSignHandoffDialogData, OrgClaSignResponse } from '@lfx-one/shared/interfaces';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaSignHandoffComponent } from './org-easycla-sign-handoff.component';

/**
 * The hand-off, from the browser's side.
 *
 * Three things are worth a test here and the rest is markup: that the attestations the signatory
 * gave are the ones sent, that the address the CLA service returned is the one navigated to, and
 * that a refusal it explained in words reaches the signatory in those words.
 */
describe('OrgEasyclaSignHandoffComponent', () => {
  const requestCorporateSignature = vi.fn();
  const close = vi.fn();
  // Assignment goes through a spy so the ordering of close-then-navigate is observable, not just
  // the final value.
  const setHref = vi.fn();
  let location: { href: string };
  let config: DynamicDialogConfig<OrgClaSignHandoffDialogData>;

  const data: OrgClaSignHandoffDialogData = {
    orgUid: '0014100000Te0xxAAC',
    projectSfid: 'a09410000182dD2AAI',
    claGroupId: 'd5d3f4f0-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    attestations: { authorityAcked: true, embargoAcked: true },
  };

  const response: OrgClaSignResponse = {
    signUrl: 'https://demo.docusign.net/Signing/StartInSession.aspx?t=abc123',
    signatureId: '7f1c2f5e-0d44-4a2b-9d61-2c9b8a7e4f30',
  };

  // Explicit rather than defaulted: a defaulted parameter would substitute the real selection for
  // the `undefined` the missing-data test means to pass, and that test would silently assert
  // nothing.
  async function renderWith(
    dialogData: OrgClaSignHandoffDialogData | undefined,
    options: { render: boolean } = { render: true }
  ): Promise<ComponentFixture<OrgEasyclaSignHandoffComponent>> {
    let href = 'https://example.test/org/easycla';
    location = {
      get href() {
        return href;
      },
      set href(value: string) {
        setHref(value);
        href = value;
      },
    };
    // The real shape and the real initial values from the call site, because the component drives
    // three of these and a bare `{ data }` stub would let a wrong initial value pass unnoticed.
    config = { data: dialogData, header: CCLA_SIGN_COPY.preparing.header, closable: false, closeOnEscape: false };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaSignHandoffComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: config },
        { provide: OrgLensClaService, useValue: { requestCorporateSignature } },
        // Only `location` is swapped. TestBed renders through DOCUMENT, so replacing it wholesale
        // breaks the fixture; jsdom also refuses a direct `document.location` assignment. Methods
        // are bound to the real document — called on the proxy they would fail on internal slots.
        {
          provide: DOCUMENT,
          useFactory: () =>
            new Proxy(globalThis.document, {
              get: (target, prop) => {
                if (prop === 'location') return location;
                const value = Reflect.get(target, prop);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaSignHandoffComponent);
    if (options.render) fixture.detectChanges();
    return fixture;
  }

  function render(): Promise<ComponentFixture<OrgEasyclaSignHandoffComponent>> {
    return renderWith(data);
  }

  function testid(fixture: ComponentFixture<OrgEasyclaSignHandoffComponent>, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  /** What `HttpClient` actually rejects with: a real `HttpErrorResponse` over this BFF's body. */
  function bffError(status: number, body: unknown): HttpErrorResponse {
    return new HttpErrorResponse({ status, statusText: 'x', url: '/api/orgs/x/lens/cla-groups/sign', error: body });
  }

  beforeEach(() => {
    requestCorporateSignature.mockReset();
    close.mockClear();
    // Reset, not clear: one case installs an implementation that reads the stash mid-navigation, and
    // leaving it in place would have it run for every later case.
    setHref.mockReset();
    sessionStorage.clear();
  });

  it('opens the signing session as the dialog opens', async () => {
    requestCorporateSignature.mockReturnValue(of(response));

    await render();

    expect(requestCorporateSignature).toHaveBeenCalledWith(data.orgUid, {
      projectSfid: data.projectSfid,
      claGroupId: data.claGroupId,
      authorityAcked: true,
      embargoAcked: true,
    });
  });

  // The client-side half of the attestation contract. The component must relay what the
  // attestation step recorded, so that a regression which lets an unaffirmed request through the
  // dialog is refused by the server rather than laundered into a `true` on the way out.
  it('relays a withdrawn confirmation as withdrawn', async () => {
    requestCorporateSignature.mockReturnValue(of(response));

    await renderWith({ ...data, attestations: { authorityAcked: true, embargoAcked: false } });

    expect(requestCorporateSignature).toHaveBeenCalledWith(data.orgUid, {
      projectSfid: data.projectSfid,
      claGroupId: data.claGroupId,
      authorityAcked: true,
      embargoAcked: false,
    });
  });

  it('tells the signatory they will become the initial CLA Manager before they commit', async () => {
    requestCorporateSignature.mockReturnValue(new Observable<OrgClaSignResponse>(() => undefined));

    const fixture = await render();

    expect(testid(fixture, 'org-easycla-sign-preparing')).not.toBeNull();
    expect(testid(fixture, 'org-easycla-sign-manager-notice')?.textContent).toContain(CCLA_SIGN_COPY.preparing.consequence);
  });

  it('offers the signing control once the session is open', async () => {
    requestCorporateSignature.mockReturnValue(of(response));

    const fixture = await render();

    expect(testid(fixture, 'org-easycla-sign-ready')).not.toBeNull();
    expect(testid(fixture, 'org-easycla-sign-preparing')).toBeNull();
  });

  // Navigated to exactly as returned, and in this tab. A new context would leave the signatory's
  // return from EasyCLA stranded on a second tab behind the console they started from.
  it('navigates this tab to the address the CLA service returned', async () => {
    requestCorporateSignature.mockReturnValue(of(response));

    const fixture = await render();
    (testid(fixture, 'org-easycla-sign-review')?.querySelector('button') as HTMLButtonElement).click();

    expect(location.href).toBe(response.signUrl);
  });

  // A full-page navigation is not a teardown. Back out of DocuSign can restore this page from
  // bfcache with the flow still marked open, which disables Sign CLA until a manual reload — so
  // the dialog must release before it navigates, not after.
  it('releases the flow before navigating away', async () => {
    requestCorporateSignature.mockReturnValue(of(response));

    const fixture = await render();
    (testid(fixture, 'org-easycla-sign-review')?.querySelector('button') as HTMLButtonElement).click();

    expect(setHref).toHaveBeenCalledWith(response.signUrl);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(setHref.mock.invocationCallOrder[0]);
  });

  it('does not navigate when the session came back without an address', async () => {
    requestCorporateSignature.mockReturnValue(of({ ...response, signUrl: '' }));

    const fixture = await render();

    expect(testid(fixture, 'org-easycla-sign-failed')).not.toBeNull();
    expect(location.href).toBe('https://example.test/org/easycla');
  });

  /**
   * The signatory returns through a cross-site redirect to an address that was composed before this
   * signature existed, so this dialog is the last place in the browser that knows which agreement
   * they are about to sign. Stashing it is what lets the return land on that agreement instead of
   * the list.
   */
  it('stashes the signature before leaving, so the return can land on the agreement', async () => {
    requestCorporateSignature.mockReturnValue(of(response));
    // Read at the moment of the navigation rather than after it. No code of ours runs once the
    // browser has left, so a stash written afterwards would never be written at all — and reading it
    // at the end of the test cannot tell the two orders apart.
    let stashedOnLeaving: string | null = null;
    setHref.mockImplementation(() => {
      stashedOnLeaving = sessionStorage.getItem(ORG_CLA_SIGNED_SIGNATURE_KEY);
    });

    const fixture = await render();
    (testid(fixture, 'org-easycla-sign-review')?.querySelector('button') as HTMLButtonElement).click();

    expect(setHref).toHaveBeenCalledWith(response.signUrl);
    expect(stashedOnLeaving).toBe(response.signatureId);
  });

  // A stash with no hand-off behind it would send the next visit to the list into a detail page for
  // an agreement nobody was ever handed.
  it('stashes nothing when the session came back without an address', async () => {
    requestCorporateSignature.mockReturnValue(of({ ...response, signUrl: '' }));

    await render();

    expect(sessionStorage.getItem(ORG_CLA_SIGNED_SIGNATURE_KEY)).toBeNull();
  });

  // A trade-compliance hold is explained upstream, names how to challenge it, and will change
  // when that process does. Replacing it with this application's generic sentence would drop the
  // only part of the message the signatory could act on.
  //
  // The fixtures below are real `HttpErrorResponse`s carrying the body this BFF actually sends.
  // `BaseApiError#toResponse` puts the message under `error`, and the validation replies put it
  // under `message`; an earlier version of this suite invented `{ error: { message } }`, which is
  // neither, and passed against a component that could not read either one.
  it("shows a refusal in the CLA service's own words", async () => {
    const refusal = 'This company is subject to a trade-compliance hold. Contact support to review the determination.';
    requestCorporateSignature.mockReturnValue(throwError(() => bffError(403, { error: refusal, code: 'UPSTREAM_ERROR' })));

    const fixture = await render();

    expect(testid(fixture, 'org-easycla-sign-failure-message')?.textContent).toContain(refusal);
  });

  // The BFF's own validation replies answer with `message`, so the relay has to read both spellings
  // — a reader that knows only one drops half of what the server says.
  it("shows a refusal the server sent under 'message'", async () => {
    const refusal = 'Both the authorization and compliance confirmations are required';
    requestCorporateSignature.mockReturnValue(throwError(() => bffError(403, { message: refusal })));

    const fixture = await render();

    expect(testid(fixture, 'org-easycla-sign-failure-message')?.textContent).toContain(refusal);
  });

  it('shows the generic failure when the refusal was not explained', async () => {
    requestCorporateSignature.mockReturnValue(throwError(() => bffError(500, { error: 'signature service unavailable' })));

    const fixture = await render();

    expect(testid(fixture, 'org-easycla-sign-failure-message')?.textContent).toContain(CCLA_SIGN_COPY.failure.body);
  });

  // Angular synthesizes a non-empty `HttpErrorResponse.message` ("Http failure response for …")
  // for every failure, so a reader that falls back to it puts an HTTP debugging string in front of
  // a signatory who was refused.
  it('shows the generic failure rather than Angular’s synthesized message when the body is empty', async () => {
    requestCorporateSignature.mockReturnValue(throwError(() => bffError(403, null)));

    const fixture = await render();

    const shown = testid(fixture, 'org-easycla-sign-failure-message')?.textContent;
    expect(shown).toContain(CCLA_SIGN_COPY.failure.body);
    expect(shown).not.toContain('Http failure response');
  });

  // By the time this state is reached the agreement and its DocuSign envelope exist upstream, and
  // the address on screen is the only way anyone reaches them. A back-out here would strand a real
  // agreement that this application cannot cancel or reuse, so the state offers no way back.
  it('offers no way out of an open session except continuing to sign it', async () => {
    requestCorporateSignature.mockReturnValue(of(response));

    const fixture = await render();

    expect(testid(fixture, 'org-easycla-sign-cancel')).toBeNull();
    expect(testid(fixture, 'org-easycla-sign-review')).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it('fails closed when it is opened without a selection', async () => {
    const fixture = await renderWith(undefined);

    expect(requestCorporateSignature).not.toHaveBeenCalled();
    expect(testid(fixture, 'org-easycla-sign-failed')).not.toBeNull();
  });

  /**
   * The signing request runs while this dialog is on screen, and it is the call that creates both
   * the signature record and the DocuSign envelope. Dismissing the dialog destroys the component
   * and its subscription, so the address that comes back is discarded and the envelope is left
   * with nobody holding it. Neither exit is available until there is something to lose.
   */
  describe('while the signing request is in flight', () => {
    it('cannot be dismissed by the header control or by Escape', async () => {
      requestCorporateSignature.mockReturnValue(new Observable<OrgClaSignResponse>(() => undefined));

      await render();

      expect(config.closable).toBe(false);
      expect(config.closeOnEscape).toBe(false);
    });

    // Still sealed on success, not just in flight. The envelope exists by then and the address on
    // screen is the only copy, so an Escape here abandons a real agreement — and `ready` waits for
    // a person, where the request itself usually answers in under a second. Sealing only the
    // in-flight window would close the smaller of the two holes.
    it('still cannot be dismissed once the session is open', async () => {
      requestCorporateSignature.mockReturnValue(of(response));

      await render();

      expect(config.closable).toBe(false);
      expect(config.closeOnEscape).toBe(false);
    });

    // The one dismissible state: no envelope to strand, and trapping someone in a dialog that
    // reports a failure would leave them no way out at all.
    it('can be dismissed once it reaches failed', async () => {
      requestCorporateSignature.mockReturnValue(throwError(() => bffError(500, { error: 'nope' })));

      await render();

      expect(config.closable).toBe(true);
      expect(config.closeOnEscape).toBe(true);
    });
  });

  /**
   * The preparing → ready transition happens on its own, with no user action behind it: the
   * request is issued as the dialog opens and the panel is rewritten when it lands. A sighted
   * user watches the spinner become a Review CCLA button. Without a live region a screen-reader
   * user hears the preparing message and then nothing at all, so the control that carries the
   * whole flow forward arrives with no event to announce it.
   */
  describe('announcing the asynchronous transition', () => {
    it('holds the dialog content in a polite live region', async () => {
      requestCorporateSignature.mockReturnValue(new Observable<OrgClaSignResponse>(() => undefined));

      const fixture = await render();

      const panel = testid(fixture, 'org-easycla-sign-handoff-dialog');
      expect(panel?.getAttribute('aria-live')).toBe('polite');
      expect(panel?.getAttribute('role')).toBe('status');
    });

    // The region has to be the container that survives the switch. Placed on a per-state branch it
    // would be created at the same moment as the content it is meant to announce, and a live
    // region that appears together with its text announces nothing.
    it('keeps the region mounted across the transition, so the change is what is announced', async () => {
      requestCorporateSignature.mockReturnValue(of(response));

      const fixture = await render();

      const panel = testid(fixture, 'org-easycla-sign-handoff-dialog');
      expect(panel?.getAttribute('aria-live')).toBe('polite');
      expect(testid(fixture, 'org-easycla-sign-ready')).toBeTruthy();
      // The ready branch itself must not carry a competing region, or the swap is announced twice.
      expect(testid(fixture, 'org-easycla-sign-ready')?.getAttribute('aria-live')).toBeNull();
    });

    // A refusal interrupts rather than waits its turn, and the nested role overrides the polite
    // ancestor for its own subtree.
    it('leaves the failure branch assertive', async () => {
      requestCorporateSignature.mockReturnValue(throwError(() => bffError(500, { error: 'nope' })));

      const fixture = await render();

      expect(testid(fixture, 'org-easycla-sign-failed')?.getAttribute('role')).toBe('alert');
    });
  });

  /**
   * The shell dialog's title is PrimeNG's, and it is a static string at the call site. Left alone
   * it keeps saying "Configuring CLA Manager Settings…" above a panel that says the session is
   * ready, or that it failed.
   */
  describe('the dialog title', () => {
    it.each([
      ['preparing', () => new Observable<OrgClaSignResponse>(() => undefined), CCLA_SIGN_COPY.preparing.header],
      ['ready', () => of(response), CCLA_SIGN_COPY.ready.header],
      ['failed', () => throwError(() => bffError(500, { error: 'nope' })), CCLA_SIGN_COPY.failure.header],
    ])('names the %s state', async (_state, source, expected) => {
      requestCorporateSignature.mockReturnValue(source());

      await render();

      expect(config.header).toBe(expected);
    });

    // Would have been the whole bug: the title is set once at the call site and the panel moves on
    // without it.
    it('does not leave the preparing title above a ready panel', async () => {
      requestCorporateSignature.mockReturnValue(of(response));

      const fixture = await render();

      expect(testid(fixture, 'org-easycla-sign-ready')).not.toBeNull();
      expect(config.header).not.toBe(CCLA_SIGN_COPY.preparing.header);
    });

    /**
     * The shell reads these as it renders, and nothing re-renders it when they change on their own.
     * Deferring the write to a render pass therefore dresses the frame for the state before this
     * one — so the assertions below are deliberately made with no pass having run at all. Rendering
     * first would hide exactly the ordering they exist to hold.
     */
    describe('without waiting for a render pass', () => {
      it('names the state the panel is already in', async () => {
        requestCorporateSignature.mockReturnValue(of(response));

        await renderWith(data, { render: false });

        expect(config.header).toBe(CCLA_SIGN_COPY.ready.header);
      });

      // The sealed-on-failure case: a frame still refusing Escape over a panel reporting a failure
      // traps the signatory in it, and there is no envelope here to justify holding them.
      it('unseals a failure', async () => {
        requestCorporateSignature.mockReturnValue(throwError(() => bffError(500, { error: 'nope' })));

        await renderWith(data, { render: false });

        expect(config.closable).toBe(true);
        expect(config.closeOnEscape).toBe(true);
      });
    });
  });
});
