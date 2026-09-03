// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { GERRIT_IDENTITY_VALUE, SIGN_IDENTITY_COPY, SIGN_IDENTITY_PLATFORM_LABELS } from '@lfx-one/shared/constants';
import type {
  ClaGroupEnablement,
  ClaKind,
  GithubAccountChoice,
  MyClaAgreement,
  SignIdentityDialogData,
  SignIdentityRef,
  SignIdentitySelectResult,
} from '@lfx-one/shared/interfaces';
import { alreadySignedAgreementForIdentity, alreadySignedIdentityTooltip, heldClaKindsForIdentity } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';
import { SelectableCardComponent } from '@components/selectable-card/selectable-card.component';

/**
 * The agreement that blocks a card, carrying the types to name in the reason.
 *
 * The kinds ride along rather than being re-derived at the tooltip, because a card blocked for
 * holding both types has to name both, and the blocking agreement is one record — reading the
 * kind off it would leave whichever happened to be newest standing for the pair.
 *
 * A local intersection rather than a `@lfx-one/shared` interface: this is the component's own
 * view model, consumed by nothing else, so it is not part of any contract between the tiers. It
 * is also the one form both repo rules allow — CLAUDE.md prohibits a local `interface Foo {}`
 * inside `apps/lfx-one/`, while ESLint's `@typescript-eslint/consistent-type-definitions`
 * rewrites a plain `type X = { … }` back into an interface on `--fix`. Same standoff as
 * `PlatformResultRow` in the campaigns implementation tab.
 */
type IdentityBlock = MyClaAgreement & { heldKinds: readonly ClaKind[] };

/**
 * "Which identity are you signing as?" step, shown between the CLA-group picker and the Console
 * hand-off (#1252). It is shown for every CLA group and every list length, an empty one included.
 *
 * It exists because the identity a CLA is recorded against used to be decided by whichever
 * record an identity search returned first, which is not a decision the contributor got to
 * make and not one that is stable across signings. That reasoning does not weaken for a Gerrit
 * group: a contributor signing under their LF identity should know that is what they are doing,
 * so the step is never skipped on the strength of the group's source (#2002). Only which
 * identities are on offer varies, and the variant says which.
 *
 * ## Where each identity comes from, and what makes each one safe
 *
 * The **GitHub accounts** come from the server, which reads them from the identity provider for
 * this session. What is chosen here is re-validated on submit: `prepareSign` re-reads the
 * session's linked accounts and refuses an id that is not among them, and the upstream service
 * derives the attested set from the caller's own token and refuses anything outside it again.
 * So this list is a UX and data-integrity constraint rather than the security boundary — an
 * account that should not be in it is refused, not recorded.
 *
 * It must still be presented as given and never taken from the URL, from user input, or from
 * anywhere but `config.data`. That is defence in depth: the server's refusal is the guarantee,
 * and this component's job is to never make it necessary.
 *
 * The **Gerrit identity** does not come from the server, and that is safe only because of what
 * happens to it — nothing. It is never submitted, never sent upstream, and never recorded. The
 * Gerrit hand-off carries the CLA group and a return address and no identity at all; the Console
 * resolves the signer from the LF SSO session itself. The username here is a label on a card, so
 * that the contributor can see whose signature this will be before they agree to it. Were it
 * ever to become an input to a request, the invariant above would apply to it too and this
 * component would be the wrong place to source it.
 *
 * With nothing at all to offer it becomes a blocking empty state rather than an empty list: the
 * contributor is told why they cannot continue at the point they tried to, instead of being
 * moved elsewhere and left to work out that the CLA group they picked was dropped (#1917). That
 * state is specific to having no *GitHub* account, and is reachable only on the `github`
 * variant — a Gerrit identity always resolves, so a variant offering one is never empty.
 *
 * That block is written out here rather than delegated to `lfx-empty-state` because that
 * component takes `title` as a required input and the design has no title — an icon, one
 * sentence, one action. Reusing it would mean inventing a heading, and the wording here is
 * required to be the design's. Its page-level proportions — a card, `p-8 md:p-16`, an 80px icon
 * badge — are the second reason; every other use of it in the app is a page or a table, not a
 * 32rem dialog. The action still takes that component's own outlined treatment, so the two
 * agree on everything but size.
 *
 * ## Identities that have already signed
 *
 * An identity that already holds every contract type the CLA group enables is grayed out with
 * the reason (#1914). This is the step that refuses, rather than the CLA-group picker before
 * it: a contributor with two linked accounts who signed under one of them can still sign under
 * the other, and a contributor who holds only an ICLA on a group that also offers an ECLA can
 * still sign the ECLA under the same identity. Refusing the whole group would deny a signature
 * they are entitled to give. The group is only tagged.
 *
 * Refusing here is a courtesy, not a guarantee — EasyCLA reuses an existing signature rather
 * than duplicating it, so what this prevents is a contributor being walked through a ceremony
 * whose outcome they already have.
 *
 * Closes with the chosen identity, with `linkAccounts` if they asked to link one, or `null` if
 * they backed out. A GitHub choice carries the account number alone, because the parent already
 * holds the list and resolves the rest from it rather than taking a handle from here.
 */
@Component({
  selector: 'lfx-sign-identity-select',
  imports: [ReactiveFormsModule, ButtonComponent, SelectableCardComponent],
  templateUrl: './sign-identity-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignIdentitySelectComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject<DynamicDialogConfig<SignIdentityDialogData>>(DynamicDialogConfig);

  protected readonly gerritValue = GERRIT_IDENTITY_VALUE;

  /**
   * Deliberately starts empty rather than preselecting anything, including when there is only
   * one card. A preselection is indistinguishable from a choice once submitted, and the whole
   * point of this step is that the identity stops being decided for the contributor.
   */
  protected readonly selectForm = new FormGroup({
    identity: new FormControl<string | null>(null),
  });

  /** Copy set for the sources on offer. A Gerrit signer is not told the group is linked to GitHub. */
  protected readonly copy = SIGN_IDENTITY_COPY[this.config.data?.variant ?? 'github'];

  /**
   * Which of the offered identities have no enabled contract type left to sign, resolved in one
   * pass before any copy is written. The refusal message names another identity only when one is
   * genuinely selectable, so how many are left has to be known before the tooltips exist — and
   * resolving it once keeps the two cards' verdicts from coming from separate evaluations.
   */
  private readonly alreadySigned = this.resolveAlreadySigned();

  /**
   * The handle can be blank: the server maps a missing `profileData.nickname` to `''` rather
   * than guessing one. Labelling that option with the account number keeps the two accounts
   * distinguishable. The blank handle itself is left alone — what gets recorded is not this
   * component's to invent.
   *
   * On a mixed variant the label carries the platform, because a GitHub handle and an LF
   * username are routinely different strings for the same person, and side by side without a
   * suffix they read as duplicates. The number fallback is exempt: it already names the
   * platform, and suffixing it would say GitHub twice.
   */
  protected readonly accounts = signal<GithubAccountChoice[]>(this.initAccounts());

  /** The contributor's LF username as their Gerrit identity, or null when Gerrit is not on offer. */
  protected readonly gerritLabel = signal<string | null>(this.initGerritLabel());

  /**
   * Why the Gerrit card cannot sign, when the contributor already holds every enabled type for
   * this group under their LF identity (#1914). Undefined ⇒ selectable.
   */
  protected readonly gerritAlreadySignedTooltip = signal<string | undefined>(this.initGerritAlreadySignedTooltip());

  protected readonly selectedId = signal<string | null>(null);
  protected readonly hasIdentities: Signal<boolean> = computed(() => this.accounts().length > 0 || this.gerritLabel() !== null);

  public constructor() {
    this.selectForm.controls.identity.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.selectedId.set(value));
  }

  protected onContinue(): void {
    const selected = this.selectedId();
    if (!selected || this.isAlreadySigned(selected)) return;

    if (selected === GERRIT_IDENTITY_VALUE) {
      this.ref.close({ kind: 'gerrit' } satisfies SignIdentitySelectResult);
      return;
    }

    this.ref.close({ kind: 'github', githubId: selected } satisfies SignIdentitySelectResult);
  }

  protected onCancel(): void {
    this.ref.close(null);
  }

  /**
   * Asks the caller to take the contributor to Identities. Navigating from here instead would
   * put routing in a dialog, which nothing else in this flow does.
   */
  protected onLinkAccounts(): void {
    this.ref.close({ linkAccounts: true } satisfies SignIdentitySelectResult);
  }

  /** Whether the chosen card is one with no enabled contract type left to sign. */
  private isAlreadySigned(identityValue: string): boolean {
    if (identityValue === GERRIT_IDENTITY_VALUE) return !!this.gerritAlreadySignedTooltip();
    return this.accounts().some((account) => account.githubId === identityValue && !!account.alreadySignedTooltip);
  }

  /**
   * Resolves the already-signed verdict for every identity the step offers, plus whether any
   * offered identity is still selectable. A Gerrit card counts as offered on the same test
   * `initGerritLabel` uses, so the two cannot disagree about whether it is on the step at all.
   */
  private resolveAlreadySigned(): { byGithubId: Map<string, IdentityBlock>; gerrit: IdentityBlock | undefined; anotherSelectable: boolean } {
    const agreements = this.config.data?.claGroupAgreements ?? [];
    const accounts = this.config.data?.accounts ?? [];
    const gerritOffered = !!this.config.data?.gerritUsername?.trim();
    const enabled: ClaGroupEnablement = {
      iclaEnabled: this.config.data?.iclaEnabled === true,
      cclaEnabled: this.config.data?.cclaEnabled === true,
    };

    // Every handle on the step, so the matcher can tell a recorded account number from a handle
    // that happens to be all digits.
    const offeredHandles = accounts.map((account) => account.githubUsername);

    const enabledKinds: readonly ClaKind[] = [...(enabled.iclaEnabled ? (['ICLA'] as const) : []), ...(enabled.cclaEnabled ? (['ECLA'] as const) : [])];

    /**
     * The gate says whether the card is blocked; these say what to call it.
     *
     * Drawn from the gate's own matcher rather than from the enablement flags, so the reason
     * describes this identity's agreements instead of standing on the gate's rule holding. Then
     * narrowed to the types the group still offers, because those are the ones the block is owed
     * to — an identity holding a type the group has since dropped is not blocked by that type,
     * and naming it would explain the graying with an agreement that has nothing to do with it.
     *
     * The narrowing is dropped when the group offers nothing, which is the gate's kind-blind
     * fallback: there the match itself is the whole reason, and an empty list would leave the
     * tooltip naming a type by default rather than the one actually held.
     */
    const blockFor = (identity: SignIdentityRef): IdentityBlock | undefined => {
      const agreement = alreadySignedAgreementForIdentity(agreements, identity, offeredHandles, enabled);
      if (!agreement) return undefined;

      const held = heldClaKindsForIdentity(agreements, identity, offeredHandles);
      const offered = held.filter((kind) => enabledKinds.includes(kind));

      return { ...agreement, heldKinds: offered.length > 0 ? offered : held };
    };

    const byGithubId = new Map<string, IdentityBlock>();
    for (const account of accounts) {
      const held = blockFor({ platform: 'github', username: account.githubUsername, githubId: account.githubId });
      if (held) byGithubId.set(account.githubId, held);
    }

    const gerrit = gerritOffered ? blockFor({ platform: 'gerrit' }) : undefined;
    const selectable = accounts.filter((account) => !byGithubId.has(account.githubId)).length + (gerritOffered && !gerrit ? 1 : 0);

    return { byGithubId, gerrit, anotherSelectable: selectable > 0 };
  }

  private initAccounts(): GithubAccountChoice[] {
    return (this.config.data?.accounts ?? []).map((account) => {
      const held = this.alreadySigned.byGithubId.get(account.githubId);

      return {
        ...account,
        label: account.githubUsername ? this.withPlatform(account.githubUsername, SIGN_IDENTITY_PLATFORM_LABELS.github) : `GitHub account ${account.githubId}`,
        ...(held ? { alreadySignedTooltip: this.identityTooltip(held) } : {}),
      };
    });
  }

  /**
   * The Gerrit card's label, and the only place a value that did not come from the server is
   * turned into something the contributor can pick. Read the class doc above before treating
   * it like the account list: it is a label, never a submission.
   */
  private initGerritLabel(): string | null {
    const username = this.config.data?.gerritUsername?.trim();
    if (!username) return null;
    return this.withPlatform(username, SIGN_IDENTITY_PLATFORM_LABELS.gerrit);
  }

  /**
   * Only meaningful when a Gerrit card is on offer at all — read off the `gerritLabel` signal,
   * declared above this one, so the card's visibility and its already-signed verdict cannot
   * come from two independent evaluations of the same question.
   */
  private initGerritAlreadySignedTooltip(): string | undefined {
    if (!this.gerritLabel()) return undefined;

    const held = this.alreadySigned.gerrit;
    return held ? this.identityTooltip(held) : undefined;
  }

  private identityTooltip(held: IdentityBlock): string {
    return alreadySignedIdentityTooltip(held, this.alreadySigned.anotherSelectable, held.heldKinds);
  }

  /** Suffixes the platform on a mixed list only; a single-source list needs no disambiguation. */
  private withPlatform(label: string, platform: string): string {
    return this.config.data?.variant === 'github-or-gerrit' ? `${label} (${platform})` : label;
  }
}
