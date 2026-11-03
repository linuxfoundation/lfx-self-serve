// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';
import {
  IT_OS_COST_NOTE,
  IT_OS_FEES,
  IT_OS_FORMATION_TEXT,
  IT_OS_GITHUB_ACTIONS,
  IT_OS_GITHUB_DEFAULT_SCENARIO,
  IT_OS_GITHUB_PAYLOAD_LABELS,
  IT_OS_GITHUB_SCENARIO_STATE,
  IT_OS_GITHUB_SCENARIOS,
  IT_OS_LF_GITHUB_ACCOUNT,
  IT_OS_SAMPLE_GITHUB_ORG,
  IT_OS_SAMPLE_PROJECT,
} from '@lfx-one/shared/constants';
import { ItOsChangePayload, ItOsGithubOrg } from '@lfx-one/shared/interfaces';

import { action, ItOsChatEngine } from './it-os-chat-engine';
import { esc, mono, plural } from './it-os-dns-html';

const LF = IT_OS_LF_GITHUB_ACCOUNT;
const P = IT_OS_SAMPLE_PROJECT;
const RE_ORG = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
/** Prototype: assumes the user did the step the agent asked for, then checks again. */
const NEXT_STATE: Record<string, Partial<ItOsGithubOrg>> = {
  none: { lf: 'invited', invite: { role: 'Owner', sent: 'today' } },
  expired: { lf: 'invited', invite: { role: 'Owner', sent: 'today' } },
  member: { lf: 'owner' },
};

const peopleUrl = (o: ItOsGithubOrg): string => mono(`github.com/orgs/${o.org}/people`);

/**
 * GitHub Org agent (#4257). Basic scope for now: make sure LF's GitHub account is an owner of each of the
 * project's orgs, work out why when it isn't, and connect more orgs. Causes and fixes follow LF's PCC
 * source control docs. Sample data only; nothing reaches GitHub.
 */
@Injectable({ providedIn: 'root' })
export class ItOsGithubAgentService extends ItOsChatEngine {
  public readonly scenarios = IT_OS_GITHUB_SCENARIOS;
  /** The project's orgs; the first one is the one the sample situations change. */
  public readonly orgs = signal<ItOsGithubOrg[]>([]);
  public readonly next = computed(() => this.orgs().find((o) => this.linked(o) !== 'full'));

  protected readonly policies = IT_OS_GITHUB_ACTIONS;
  protected readonly payloadLabels = IT_OS_GITHUB_PAYLOAD_LABELS;

  /** Waiting for the name of another org. */
  private askingOrg = false;

  public constructor() {
    super();
    this.resetData();
  }

  public suggestions(): string[] {
    const next = this.next();
    const another = 'We have another org called example-foundation-labs';
    if (!next) return [another, 'Who are the org owners?'];
    if (!next.exists) return [another];
    return ["I've done it, check again", "I can't change roles", `I can't find ${LF}`, another];
  }

  /** PCC linked_status: full, partial, none or not_created. */
  public linked(o: ItOsGithubOrg): string {
    if (!o.exists) return 'not_created';
    if (o.lf === 'owner') return o.pat === 'ok' ? 'full' : 'partial';
    return o.lf === 'member' ? 'partial' : 'none';
  }

  /** Status line for one org. */
  public orgStatus(o: ItOsGithubOrg): { ok: boolean; text: string } {
    if (!o.exists) return { ok: false, text: `GitHub can't find ${o.org}` };
    if (o.lf === 'owner') return o.pat === 'ok' ? { ok: true, text: `${LF} is an owner` } : { ok: false, text: 'Owner, but the token is blocked' };
    const text: Record<string, string> = {
      none: `${LF} isn't in the org`,
      invited: o.invite?.role === 'Owner' ? 'Invitation waiting for LF' : 'Invited with the wrong role',
      expired: 'Invitation expired',
      member: `${LF} isn't an owner yet`,
    };
    return { ok: false, text: text[o.lf] ?? '' };
  }

  /** Status for the agent card: one org, or a count across orgs. */
  public status(): { ok: boolean; text: string } {
    const orgs = this.orgs();
    const bad = orgs.filter((o) => this.linked(o) !== 'full');
    if (orgs.length === 1) return this.orgStatus(orgs[0]);
    if (!bad.length) return { ok: true, text: `${LF} is an owner of all ${orgs.length} orgs` };
    return { ok: false, text: `${bad.length} of ${orgs.length} orgs ${bad.length === 1 ? 'needs' : 'need'} attention` };
  }

  public owners(o: ItOsGithubOrg): ItOsGithubOrg['members'] {
    return o.members.filter((m) => m.role === 'Owner' && m.login !== LF);
  }

  // === Engine hooks ===

  protected resetData(): void {
    this.orgs.set([structuredClone(IT_OS_SAMPLE_GITHUB_ORG)]);
    this.scenario.set(IT_OS_GITHUB_DEFAULT_SCENARIO);
    this.askingOrg = false;
  }

  protected applyScenario(id: string): void {
    const first = this.orgs()[0];
    this.update(first, IT_OS_GITHUB_SCENARIO_STATE[id] ?? {});
    this.scenario.set(id);
    this.askingOrg = false;
  }

  protected apply(key: string, payload: ItOsChangePayload): void {
    if (key !== 'gh.addOrg') return;
    const first = this.orgs()[0];
    const owners = this.owners(first).map((m) => ({ ...m }));
    this.orgs.update((list) => [...list, { org: String(payload['org']), lf: 'none', invite: null, pat: 'ok', exists: true, members: owners }]);
  }

  protected greet(): void {
    const orgs = this.orgs();
    if (orgs.length > 1)
      this.bot(
        `<p>${esc(P.name)} has ${orgs.length} GitHub orgs:</p><ul>${orgs.map((o) => `<li>${mono(o.org)}: ${esc(this.orgStatus(o).text)}</li>`).join('')}</ul>`
      );
    this.diagnose(this.next() ?? orgs[0]);
  }

  protected route(text: string): void {
    const t = text.toLowerCase();
    if (this.askingOrg && /^\s*(https?:\/\/)?(github\.com\/)?[a-z0-9-]+\/?\s*$/i.test(text)) return this.addOrg(text);
    this.askingOrg = false;
    const named = this.orgIn(text);
    const o = named ?? this.next() ?? this.orgs()[0];
    const linked = this.linked(o);

    // Another org: "invite thelinuxfoundation to example-labs", "we have another org called example-labs".
    const newName = (text.match(
      /\binvite\s+(?:the\s*linux\s*foundation|lf)\s+(?:to|into)\s+(?:the\s+|our\s+)?(?:org\s+|organi[sz]ation\s+)?(?:github\.com\/)?([a-z0-9-]+)/i
    ) ??
      text.match(/\b(?:org|organi[sz]ation)\s+(?:called\s+|named\s+)?(?:github\.com\/)?([a-z0-9-]+)/i) ??
      text.match(/github\.com\/([a-z0-9-]+)/i) ??
      [])[1];
    const wantsNew = /another|second|third|other|new|add|connect|also|more than one/.test(t) && /\borg|organi[sz]ation|github\.com/.test(t);
    const invitesLf = /invite\s+(the\s*)?linux\s*foundation|invite\s+lf/.test(t);
    if ((wantsNew || invitesLf) && newName && !this.orgBy(newName) && !/^(the|a|an|our|another|second|third|org|to)$/i.test(newName))
      return this.addOrg(newName);
    if (invitesLf && named) return this.diagnose(named);
    if (wantsNew && !named) {
      this.askingOrg = true;
      this.bot("<p>What's the other org's name on GitHub? It's the part after github.com/.</p>");
      return;
    }

    if (/(can'?t|cannot|unable|no permission|not allowed|gr[ae]yed|don'?t see).*(role|owner|invite|change)/.test(t)) {
      const owners = this.owners(o);
      this.bot(
        `<p>Only owners of ${mono(o.org)} can invite people or change roles. Its owners are ${owners.map((m) => `${mono(m.login)} (${esc(m.name)})`).join(' and ')}. If you're one of them, check that you're signed in to GitHub with that account.</p>`
      );
      return;
    }
    if (/(can'?t|cannot|unable|doesn'?t|don'?t).*(find|show|appear)|not found|no (such )?user/.test(t)) {
      this.bot(
        `<p>Search for the exact username ${mono(LF)}, one word starting with "the". ${mono('linuxfoundation')} is a different account. Its profile is ${mono(`github.com/${LF}`)}.</p>`
      );
      return;
    }
    if (/expire/.test(t)) {
      const which = o.lf === 'expired' && o.invite ? ` That's what happened to the one for ${mono(o.org)} sent ${esc(o.invite.sent)}.` : '';
      this.bot(`<p>GitHub invitations expire after 7 days if they aren't accepted. An expired invitation has to be deleted and sent again.${which}</p>`);
      return;
    }
    if (/token|\bpat\b/.test(t)) {
      const now = o.pat === 'ok' ? `${mono(o.org)}'s policy is fine.` : `That's the problem with ${mono(o.org)} right now.`;
      this.bot(
        `<p>LF connects to your org with a personal access token that belongs to ${mono(LF)}. If the org doesn't allow personal access tokens, or requires them to expire, the connection fails even when ${mono(LF)} is an owner. ${now}</p>`
      );
      return;
    }
    if (/why/.test(t) && /owner|lf|linux/.test(t)) {
      const now = linked === 'full' ? `It already is for ${mono(o.org)}.` : `Right now it isn't for ${mono(o.org)}.`;
      this.bot(`<p>${mono(LF)} has to be an owner of every GitHub org for an LF project. It's required, not optional. ${now}</p>`);
      return;
    }
    if (/done|check|verify|sent|changed|fixed|invited|accepted/.test(t)) return linked === 'full' ? this.diagnose(o) : this.verify(o);
    if (/which orgs|list.*orgs|our orgs|all orgs|orgs\b/.test(t)) {
      this.bot(
        `<ul>${this.orgs()
          .map((x) => `<li>${mono(x.org)}: ${esc(this.orgStatus(x).text)}</li>`)
          .join('')}</ul>`
      );
      return;
    }
    if (/who.*owner|owners/.test(t)) {
      this.bot(
        `<ul>${o.members
          .filter((m) => m.role === 'Owner')
          .map((m) => `<li>${mono(m.login)} · ${esc(m.name)}</li>`)
          .join('')}</ul>`
      );
      return;
    }
    if (/cost|price|pay|free|fee/.test(t)) return this.feeAnswer();
    if (/repo|invite|remove|member|transfer|team|access/.test(t)) {
      this.bot(
        "<p>For now I only make sure LF has owner access to the project's GitHub orgs. IT OS will cover repos and people later. Contact support for those for now.</p>"
      );
      return;
    }
    if (named || /status|connected|what'?s wrong|problem|help/.test(t)) return this.diagnose(o);
    this.bot(
      `<p>I check that ${mono(LF)} is an owner of each of the project's GitHub orgs and help fix it when it isn't. Try "check again", "we have another org called example-labs" or "I can't change roles".</p>`
    );
  }

  // === Diagnosis ===

  /** What's wrong with one org right now, in plain words, with the fix. */
  private diagnose(o: ItOsGithubOrg): void {
    const org = mono(o.org);
    const lf = mono(LF);
    const check = action("I've done it, check again", () => this.verify(o), true);
    if (!o.exists) {
      this.bot(
        `<p>GitHub doesn't have an org called ${org} any more, so LF can't reach it. It was probably renamed or deleted.</p><p>What happened to it?</p>`,
        {
          actions: [
            action(
              'It was renamed',
              () => this.bot(`<p>LF needs the new name to reconnect it to ${esc(P.name)}. Contact support with the new org name.</p>`),
              true
            ),
            action("We don't use it any more", () => this.bot(`<p>Then the org should be disconnected from ${esc(P.name)}. Contact support to do that.</p>`)),
          ],
        }
      );
      return;
    }
    if (o.lf === 'none') {
      this.bot(
        `<p>${lf} isn't part of ${org}, so LF can't manage its repositories. An org owner needs to invite it as an owner of the whole org, not of single repos:</p>${this.inviteSteps(o)}`,
        {
          actions: [check],
        }
      );
      return;
    }
    if (o.lf === 'invited' && o.invite?.role !== 'Owner') {
      this.bot(
        `<p>There's a pending invitation for ${lf} to ${org}, sent ${esc(o.invite?.sent)}, but it's for the <b>Member</b> role. LF needs to be an owner. Cancel that invitation and send a new one:</p>
        <ol><li>Open ${peopleUrl(o)} and find the pending invitation for <b>${LF}</b>.</li><li>Cancel it.</li><li>Invite <b>${LF}</b> again with the <b>Owner</b> role.</li><li>Tell me when it's sent.</li></ol>`,
        { actions: [check] }
      );
      return;
    }
    if (o.lf === 'invited') {
      this.bot(
        `<p>There's an invitation for ${lf} to ${org} with the Owner role, sent ${esc(o.invite?.sent)}. LF accepts it on its side. That works because ${org} is connected to ${esc(P.name)} in LFX. Invitations expire after 7 days if they aren't accepted.</p>`,
        { actions: [action('Check again', () => this.verify(o), true)] }
      );
      return;
    }
    if (o.lf === 'expired') {
      this.bot(
        `<p>An invitation for ${lf} to ${org} was sent ${esc(o.invite?.sent)}, but it expired. GitHub invitations expire after 7 days. An expired invitation has to be deleted and sent again:</p>${this.inviteSteps(o, `<li>Open ${peopleUrl(o)}, find the expired invitation for <b>${LF}</b> and delete it.</li>`)}`,
        { actions: [check] }
      );
      return;
    }
    if (o.lf === 'member') {
      this.bot(
        `<p>${lf} is a member of ${org} but not an owner, so the connection is only partial. That's the most common cause: it was invited as a member instead of an owner. An org owner can fix it:</p>
        <ol><li>Open ${peopleUrl(o)}.</li><li>Select <b>${LF}</b>, choose <b>Change role</b> and pick <b>Owner</b>.</li><li>Tell me when it's done.</li></ol>`,
        { actions: [check] }
      );
      return;
    }
    if (o.pat !== 'ok') {
      const policy =
        o.pat === 'disallowed' ? `${org} doesn't allow personal access tokens` : `${org} requires personal access tokens to expire. LF's token doesn't expire`;
      this.bot(
        `<p>${lf} is an owner of ${org}, but the connection still doesn't work. LF connects with a personal access token that belongs to ${lf}, and ${policy}.</p>
        <p>An org owner can change this in the org's settings, under <b>Personal access tokens</b>. If the project can't change that policy, contact support.</p>`,
        { actions: [check] }
      );
      return;
    }
    const next = this.next();
    this.bot(
      `<p>${lf} is an owner of ${org}, so LF is fully connected to it.${next ? '' : ' Nothing to do here.'}</p>`,
      next ? { actions: [action(`Look at ${next.org}`, () => this.diagnose(next), true)] } : {}
    );
  }

  private inviteSteps(o: ItOsGithubOrg, first = `<li>Open ${peopleUrl(o)}.</li>`): string {
    return `<ol>${first}<li>Click <b>Invite member</b> and search for exactly <b>${LF}</b>.</li><li>Choose the <b>Owner</b> role and send the invitation.</li><li>Tell me when it's sent.</li></ol>`;
  }

  private verify(o: ItOsGithubOrg): void {
    this.work('', [`Checked ${LF}'s role in ${o.org}`, 'Checked pending invitations', "Checked the org's token policy"], () => {
      const before = this.linked(o);
      if (o.lf === 'invited') {
        this.update(o, o.invite?.role === 'Owner' ? { lf: 'owner', pat: o.pat } : { lf: 'invited', invite: { role: 'Owner', sent: 'today' }, pat: o.pat });
      } else if (NEXT_STATE[o.lf]) {
        this.update(o, { pat: o.pat, ...NEXT_STATE[o.lf] });
      } else if (o.lf === 'owner' && o.pat !== 'ok') {
        this.update(o, { lf: 'owner' });
      }
      if (this.linked(o) === 'full' && before !== 'full') {
        const next = this.next();
        let tail = ' That required step is done.';
        if (next) tail = ` ${mono(next.org)} still needs attention.`;
        else if (this.orgs().length > 1) tail = ' Every org is connected.';
        this.bot(
          `<p>${mono(LF)} is an owner of ${mono(o.org)} now, and LF is fully connected to it.${tail}</p>`,
          next ? { actions: [action(`Look at ${next.org}`, () => this.diagnose(next), true)] } : {}
        );
        return;
      }
      this.diagnose(o);
    });
  }

  // === More orgs ===

  /** LF can only accept the invitation once the org is connected to the project in LFX. */
  private addOrg(raw: string): void {
    this.askingOrg = false;
    const name = raw
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/^github\.com\//i, '')
      .replace(/\/.*$/, '');
    if (!RE_ORG.test(name)) {
      this.askingOrg = true;
      this.bot("<p>That doesn't look like a GitHub org name. It's the part after github.com/, for example example-foundation-labs.</p>");
      return;
    }
    const existing = this.orgBy(name);
    if (existing) {
      this.bot(`<p>${mono(existing.org)} is already connected to ${esc(P.name)}.</p>`);
      this.diagnose(existing);
      return;
    }
    this.plan(
      `<p>LF can only accept an invitation to an org that's connected to the project, so I'll connect ${mono(name)} to ${esc(P.name)} first. Then you invite ${mono(LF)} as an owner.</p>`,
      [{ key: 'gh.addOrg', payload: { org: name } }],
      () => {
        const added = this.orgBy(name);
        if (added) this.diagnose(added);
      }
    );
  }

  private feeAnswer(): void {
    if (!this.staff()) {
      this.bot(`<p>${IT_OS_FORMATION_TEXT}</p>`);
      return;
    }
    const n = this.orgs().length;
    this.bot(
      `<p>The LF IT GitHub fee is ${IT_OS_FEES.githubBase}/mo base plus ${IT_OS_FEES.githubPerOrg}/mo per organization. ${esc(P.name)} has ${plural(n, 'org')}.</p><p class="text-xs text-gray-500">${esc(IT_OS_COST_NOTE)}</p>`
    );
  }

  // === Data helpers ===

  private orgBy(name: string): ItOsGithubOrg | undefined {
    return this.orgs().find((o) => o.org.toLowerCase() === name.toLowerCase());
  }

  private orgIn(text: string): ItOsGithubOrg | undefined {
    return this.orgs().find((o) => new RegExp(`(^|[^a-z0-9-])${o.org.replace(/-/g, '\\-')}([^a-z0-9-]|$)`, 'i').test(text));
  }

  /** Sets an org's state and keeps thelinuxfoundation's place in its people list in step. */
  private update(o: ItOsGithubOrg, state: Partial<ItOsGithubOrg>): void {
    Object.assign(o, { lf: 'member', invite: null, pat: 'ok', exists: true }, state);
    o.members = o.members.filter((m) => m.login !== LF);
    if (o.lf === 'owner' || o.lf === 'member') o.members.splice(2, 0, { login: LF, name: 'The Linux Foundation', role: o.lf === 'owner' ? 'Owner' : 'Member' });
    this.orgs.update((list) => [...list]);
  }
}
