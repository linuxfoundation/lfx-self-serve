// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';
import {
  IT_OS_COST_NOTE,
  IT_OS_FEES,
  IT_OS_FORMATION_TEXT,
  IT_OS_FORWARD_SOURCE,
  IT_OS_FORWARD_STANDARD,
  IT_OS_FORWARD_TIER_LABELS,
  IT_OS_FORWARDING_ACTIONS,
  IT_OS_FORWARDING_DEFAULT_SCENARIO,
  IT_OS_FORWARDING_PAYLOAD_LABELS,
  IT_OS_FORWARDING_SCENARIOS,
  IT_OS_SAMPLE_FORWARDS,
  IT_OS_SAMPLE_PROJECT,
  IT_OS_SAMPLE_STAFF,
} from '@lfx-one/shared/constants';
import { ItOsChangePayload, ItOsChatField, ItOsChatForm, ItOsForward, ItOsForwardFinding, ItOsForwardStandard } from '@lfx-one/shared/interfaces';

import { action, ItOsChatEngine } from './it-os-chat-engine';
import { esc, htmlTable, mono, muted, plural } from './it-os-dns-html';

const DOMAIN = IT_OS_SAMPLE_PROJECT.primaryDomain;
const STAFF = IT_OS_SAMPLE_STAFF;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_EMAILS = /[^\s@,<>()]+@[^\s@,<>()]+\.[a-z]{2,}/gi;
const ARROW = ' → ';

const stdOf = (alias: string): ItOsForwardStandard | undefined => IT_OS_FORWARD_STANDARD.find((s) => s.alias === alias);
const tierOf = (tier: string): ItOsForwardStandard[] => IT_OS_FORWARD_STANDARD.filter((s) => s.tier === tier);
const emails = (list: { email: string }[]): string => list.map((x) => x.email).join(', ');
const sameDest = (a: string, b: string): boolean => {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean)
      .sort()
      .join();
  return norm(a) === norm(b);
};
const splitEmails = (value: string): string[] => value.split(/[\s,]+/).filter(Boolean);
const source = muted(esc(IT_OS_FORWARD_SOURCE));

/** Levenshtein distance, for spotting typos in domains. */
const editDistance = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
};

/** Where a standard address goes for this project, from its staff in LFX. */
export const standardDestination = (alias: string): string => {
  const destinations: Record<string, string> = {
    support: 'LF support (Intercom)',
    operations: emails([...STAFF.pms, STAFF.ed]),
    membership: STAFF.sales.length ? `operations@${DOMAIN}, sales@${DOMAIN}` : `operations@${DOMAIN}`,
    marketing: STAFF.marketing.length ? emails(STAFF.marketing) : `support@${DOMAIN}`,
    pr: STAFF.pr.length ? emails(STAFF.pr) : `support@${DOMAIN}`,
    legal: `operations@${DOMAIN}`,
    conduct: `support@${DOMAIN}`,
    security: 'Named security responders',
    staff: `operations@${DOMAIN}, marketing@${DOMAIN}`,
    social: STAFF.marketing.length ? emails(STAFF.marketing) : `marketing@${DOMAIN}`,
    sales: STAFF.sales.length ? emails(STAFF.sales) : 'Sales staff assigned to the project',
    mentorship: `support@${DOMAIN}`,
    cla: `support@${DOMAIN}`,
    zoom: `operations@${DOMAIN}`,
  };
  return destinations[alias] ?? '';
};

/**
 * Email Forwarding agent (#4257). Sets up LF's standard addresses on the primary domain, adds any other
 * address the project needs, and checks existing forwards against the standard with suggested fixes.
 * Forwarding never needs LF IT approval. Sample data only; nothing reaches Forward Email.
 */
@Injectable({ providedIn: 'root' })
export class ItOsForwardingAgentService extends ItOsChatEngine {
  public readonly scenarios = IT_OS_FORWARDING_SCENARIOS;
  public readonly domain = DOMAIN;
  public readonly enabled = signal(false);
  public readonly forwards = signal<ItOsForward[]>([]);
  public readonly findings = computed(() => this.findingsFor(this.enabled(), this.forwards()));
  /** Required and, before forwarding is on, every standard address that isn't set up. */
  public readonly missing = computed(() =>
    IT_OS_FORWARD_STANDARD.filter((s) => s.tier !== 'dont' && !this.has(s.alias) && (s.tier === 'required' || !this.enabled()))
  );

  protected readonly policies = IT_OS_FORWARDING_ACTIONS;
  protected readonly payloadLabels = IT_OS_FORWARDING_PAYLOAD_LABELS;

  /** The address the agent asked "where should it go?" about. */
  private asking: string | null = null;

  public constructor() {
    super();
    this.resetData();
  }

  public suggestions(): string[] {
    const custom = 'Add a forward for careers@ to jrivera@example.org';
    if (this.enabled()) return ['Check our forwards against the standard', 'Add the missing ones', custom, 'Can we add info@?'];
    return ['Set up the standard addresses', custom, 'Which addresses are optional?', 'Show me the standard'];
  }

  /** Status for the agent card. */
  public status(): { ok: boolean; text: string } {
    if (!this.enabled()) return { ok: false, text: 'Not set up yet' };
    const n = this.findings().filter((f) => f.tone !== 'info').length;
    return n ? { ok: false, text: `${plural(n, 'fix', 'fixes')} to match the guidelines` } : { ok: true, text: 'Forwards match the guidelines' };
  }

  public standardFor(alias: string): ItOsForwardStandard | undefined {
    return stdOf(alias);
  }

  public tierLabel(alias: string): string {
    const s = stdOf(alias);
    return s ? IT_OS_FORWARD_TIER_LABELS[s.tier] : 'Not in standard';
  }

  public findingFor(alias: string): ItOsForwardFinding | undefined {
    return this.findings().find((f) => f.alias === alias);
  }

  public destinationFor(s: ItOsForwardStandard): string {
    return s.tbd ? 'Still being confirmed by LF' : standardDestination(s.alias);
  }

  public dontList(): string {
    return tierOf('dont')
      .map((s) => `${s.alias}@`)
      .join(', ');
  }

  // === Engine hooks ===

  protected resetData(): void {
    this.enabled.set(false);
    this.forwards.set([]);
    this.scenario.set(IT_OS_FORWARDING_DEFAULT_SCENARIO);
    this.asking = null;
  }

  protected applyScenario(id: string): void {
    const review = id === 'review';
    this.enabled.set(review);
    this.forwards.set(review ? structuredClone(IT_OS_SAMPLE_FORWARDS) : []);
    this.scenario.set(id);
    this.asking = null;
  }

  protected apply(key: string, p: ItOsChangePayload): void {
    const alias = String(p['alias'] ?? '');
    const list = this.forwards();
    if (key === 'fwd.enable') {
      const added = (Array.isArray(p['aliases']) ? p['aliases'] : []).map((line) => {
        const [a, dest] = line.split(ARROW);
        return { alias: a.replace(/@$/, ''), dest };
      });
      this.enabled.set(true);
      this.forwards.set([...list, ...added]);
    } else if (key === 'fwd.addAlias') {
      this.forwards.set([...list, { alias, dest: String(p['dest']) }]);
    } else if (key === 'fwd.editAlias') {
      this.forwards.set(list.map((f) => (f.alias === alias ? { alias, dest: String(p['dest']) } : f)));
    } else if (key === 'fwd.deleteAlias') {
      this.forwards.set(list.filter((f) => f.alias !== alias));
    } else if (key === 'fwd.autoReply') {
      this.forwards.set(list.map((f) => (f.alias === alias ? { alias, dest: `Auto-reply: use ${p['instead']}`, autoReply: String(p['instead']) } : f)));
    }
  }

  protected greet(): void {
    if (!this.enabled()) {
      const noStaff = !STAFF.marketing.length || !STAFF.pr.length;
      this.bot(
        `<p>Forwarding isn't set up for ${mono(DOMAIN)} yet. Email forwarding is currently available only for the primary domain.</p>
        <p>LF's standard has ${tierOf('required').length} required addresses. I can fill in where they all go from LFX, except ${mono('events@')}, which LF is still confirming.${noStaff ? ` The project has no marketing or PR staff in LFX, so ${mono('marketing@')} and ${mono('pr@')} go to ${mono('support@')}, as the standard says.` : ''}</p>
        <p>There are also ${tierOf('ifneeded').length} "if needed" and ${tierOf('optional').length} optional addresses. I'll ask which ones the project wants. I can also add any other address the project needs.</p>`,
        { actions: [action('Set up the standard addresses', () => this.standardForm(), true), action('Show me the standard', () => this.showStandard())] }
      );
      return;
    }
    const problems = this.findings().filter((f) => f.tone !== 'info');
    if (problems.length) {
      this.bot(
        `<p>Forwarding is on for ${mono(DOMAIN)} with ${plural(this.forwards().length, 'address', 'addresses')}. I checked them against LF's standard: ${plural(problems.length, 'thing needs', 'things need')} fixing.</p>`,
        { actions: [action('Show me', () => this.review(), true)] }
      );
      return;
    }
    this.bot(`<p>Forwarding is on for ${mono(DOMAIN)} with ${plural(this.forwards().length, 'address', 'addresses')}, and they match LF's standard.</p>`);
  }

  protected route(text: string): void {
    const t = text.toLowerCase();
    if (/review|audit|check|compare|outside|against|guideline|what'?s wrong|match/.test(t) && !/@\s*(→|->|to\b)/.test(t)) return this.review();
    const named = IT_OS_FORWARD_STANDARD.find(
      (s) => new RegExp(`\\b${s.alias}@`).test(t) || new RegExp(`\\b(add|create|set up|need)\\s+(an?\\s+)?${s.alias}\\b`).test(t)
    );

    // "jobs@ → name@example.org", one per line.
    let pairs = text
      .split(/\n+/)
      .map((line) => line.trim().match(/^([a-z0-9._-]+)(?:@\S*)?\s*(?:→|->|=>|\bto\b|:)\s*(\S+@\S+(?:\s*,\s*\S+@\S+)*)$/i))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ alias: m[1].toLowerCase(), dest: m[2] }));

    // Plain sentences: "I also need heather@examplefoundation.org to forward to name@example.org".
    // The first address on the project's domain (or a bare "name@") is the new address; every other email is where it goes.
    if (!pairs.length && /add|create|new|set ?up|forward|make|need|want|→|->|\bto\b/.test(t)) {
      const own = new RegExp(`(^|[\\s,(])([a-z0-9._-]+)@(?:${DOMAIN.replace(/\./g, '\\.')})?(?=[\\s,.)?!]|$)`, 'i');
      const alias = ((text.match(own) ?? [])[2] ?? '').toLowerCase();
      const dests = (text.match(RE_EMAILS) ?? []).filter((e) => e.toLowerCase() !== `${alias}@${DOMAIN}`);
      const asks = /add|create|new|set ?up|forward|make|need|want/.test(t);
      if (alias && dests.length) pairs = [{ alias, dest: dests.join(', ') }];
      else if (alias && !stdOf(alias) && asks) return this.askWhere(alias);
      // The new address is on another domain, often a typo. Forwarding only works on the primary domain.
      const all = text.match(RE_EMAILS) ?? [];
      if (!alias && all.length >= 2 && asks) return this.otherDomain(all);
    }
    // Answer to "Where should x@ go?"
    const answer = this.asking ? text.match(RE_EMAILS) : null;
    if (!pairs.length && this.asking && answer) pairs = [{ alias: this.asking, dest: answer.join(', ') }];
    this.asking = null;
    if (pairs.length) return this.addForwards(pairs);

    if (named && named.tier === 'dont') return this.dont(named);
    if (/optional|if needed/.test(t) && /which|what/.test(t)) return this.listOptional();
    if (/show|what.*standard|full standard/.test(t)) return this.showStandard();
    if (named || /standard|set ?up|turn on|enable|missing|optional|add more/.test(t)) return this.standardForm();
    const del = t.match(/(?:delete|remove)\s+([a-z0-9._-]+)@?/);
    if (del) return this.remove(del[1]);
    if (/cost|price|pay|how much|fee/.test(t)) return this.feeAnswer();
    if (/primary|why only|other domain/.test(t)) {
      this.bot(`<p>Email forwarding is currently available only for the primary domain. For ${esc(IT_OS_SAMPLE_PROJECT.name)} that's ${mono(DOMAIN)}.</p>`);
      return;
    }
    if (/where|which|list|go/.test(t)) {
      const list = this.forwards();
      this.bot(
        list.length
          ? `<ul>${list.map((f) => `<li>${mono(`${f.alias}@${DOMAIN}`)} → ${esc(f.dest)}</li>`).join('')}</ul>`
          : '<p>No addresses forward anywhere yet.</p>'
      );
      return;
    }
    this.bot("<p>I can set up LF's standard addresses, add any other address the project needs, or check existing forwards against the standard.</p>");
  }

  // === Standard addresses ===

  private showStandard(): void {
    const rows = IT_OS_FORWARD_STANDARD.map((s) => [
      mono(`${s.alias}@`),
      esc(IT_OS_FORWARD_TIER_LABELS[s.tier]),
      s.tier === 'dont' ? `Use ${esc(s.instead)} instead` : esc(this.destinationFor(s)),
      `<span class="text-gray-500">${esc([s.purpose, s.note].filter(Boolean).join(' '))}</span>`,
    ]);
    this.bot(`<p>LF's standard project addresses:</p>${htmlTable(['Address', '', 'Goes to', 'Notes'], rows)}${source}`, {
      actions: [action('Set up the standard addresses', () => this.standardForm(), true)],
    });
  }

  private listOptional(): void {
    const item = (s: ItOsForwardStandard): string => `<li>${mono(`${s.alias}@`)} → ${esc(standardDestination(s.alias))}. ${esc(s.purpose)}</li>`;
    this.bot(
      `<p><b>If needed:</b></p><ul>${tierOf('ifneeded').map(item).join('')}</ul><p><b>Optional:</b></p><ul>${tierOf('optional').map(item).join('')}</ul>${source}`,
      {
        actions: [action('Add some of these', () => this.standardForm(), true)],
      }
    );
  }

  private standardForm(): void {
    const required = tierOf('required').filter((s) => !s.tbd && !this.has(s.alias));
    const extra = IT_OS_FORWARD_STANDARD.filter((s) => (s.tier === 'ifneeded' || s.tier === 'optional') && !this.has(s.alias));
    if (!required.length && !extra.length) {
      this.bot('<p>Every standard address is already set up.</p>');
      return;
    }
    const askStaff = required.filter((s) => (s.alias === 'marketing' && !STAFF.marketing.length) || (s.alias === 'pr' && !STAFF.pr.length));
    const fields: ItOsChatField[] = [
      ...askStaff.map((s) => ({
        id: `staff-${s.alias}`,
        kind: 'text',
        label: `${s.alias}@ (optional: the project's ${s.alias === 'pr' ? 'PR' : 'marketing'} staff)`,
        placeholder: 'name@example.org',
      })),
      ...extra.flatMap((s) => {
        const pick: ItOsChatField = {
          id: `pick-${s.alias}`,
          kind: 'checkbox',
          label: `${s.alias}@ → ${standardDestination(s.alias)} (${IT_OS_FORWARD_TIER_LABELS[s.tier].toLowerCase()})`,
          hint: [s.purpose, s.note].filter(Boolean).join(' '),
        };
        return s.ask
          ? [pick, { id: `who-${s.alias}`, kind: 'text', label: `The ${s.ask}`, placeholder: 'name@example.org, name2@example.org', indent: true }]
          : [pick];
      }),
    ];
    const requiredHtml = required.length
      ? `<p><b>Required.</b> From LFX, these go where the standard says:</p>${htmlTable(
          ['Address', 'Goes to'],
          required.map((s) => [mono(`${s.alias}@`), esc(standardDestination(s.alias))])
        )}`
      : '';
    const form: ItOsChatForm = { fields, values: {} };
    const note = muted(
      `${this.has('events') ? '' : `${mono('events@')} is left out until LF confirms where it goes. `}The standard says not to create ${esc(this.dontList())}. Need an address that isn't in the standard? Tell me, like "jobs@ → name@example.org".`
    );
    this.bot(
      `${requiredHtml}<p>Tick any "if needed" or optional addresses the project wants.${askStaff.length ? " If the project has marketing or PR staff, add them and I'll route there instead of support@." : ''}</p>${note}${source}`,
      { form, actions: [action('Use these', () => this.buildFromForm(form), true)] }
    );
  }

  private buildFromForm(form: ItOsChatForm): void {
    const value = (id: string): string => String(form.values[id] ?? '').trim();
    const aliases = tierOf('required')
      .filter((s) => !s.tbd && !this.has(s.alias))
      .map((s) => ({ alias: s.alias, dest: standardDestination(s.alias) }));
    for (const alias of ['marketing', 'pr']) {
      const typed = value(`staff-${alias}`);
      if (!typed) continue;
      const list = splitEmails(typed);
      if (!list.every((e) => RE_EMAIL.test(e))) {
        this.bot(`<p>That doesn't look like an email address for ${mono(`${alias}@`)}. Leave it empty to use support@.</p>`);
        return this.standardForm();
      }
      const found = aliases.find((a) => a.alias === alias);
      if (found) found.dest = list.join(', ');
    }
    const picked = IT_OS_FORWARD_STANDARD.filter(
      (s) => (s.tier === 'ifneeded' || s.tier === 'optional') && !this.has(s.alias) && form.values[`pick-${s.alias}`] === true
    );
    for (const s of picked) {
      if (!s.ask) {
        aliases.push({ alias: s.alias, dest: standardDestination(s.alias) });
        continue;
      }
      const list = splitEmails(value(`who-${s.alias}`));
      if (!list.length || !list.every((e) => RE_EMAIL.test(e))) {
        this.bot(`<p>For ${mono(`${s.alias}@`)}, I need the email addresses of the ${esc(s.ask)}.</p>`);
        return this.standardForm();
      }
      aliases.push({ alias: s.alias, dest: list.join(', ') });
    }
    if (!aliases.length) {
      this.bot('<p>Nothing to add.</p>');
      return;
    }
    const social = aliases.some((a) => a.alias === 'social')
      ? muted(`${mono('social@')} gets an auto-reply saying it isn't monitored and to use support@.`)
      : '';
    if (!this.enabled()) {
      this.plan(
        `<p>This turns on forwarding for ${mono(DOMAIN)} with ${plural(aliases.length, 'address', 'addresses')}. They work as soon as you confirm.</p>${social}`,
        [{ key: 'fwd.enable', payload: { aliases: aliases.map((a) => `${a.alias}@${ARROW}${a.dest}`) } }]
      );
      return;
    }
    this.plan(
      `<p>Here are the addresses to add:</p>${social}`,
      aliases.map((a) => ({ key: 'fwd.addAlias', payload: a }))
    );
  }

  private dont(s: ItOsForwardStandard): void {
    this.bot(
      `<p>The LF standard says not to create ${mono(`${s.alias}@`)}. Use ${esc(s.instead)} instead.</p>${muted(`If the project already has ${mono(`${s.alias}@`)}, the standard is an auto-reply that points people to ${esc(s.instead)}.`)}${source}`
    );
  }

  // === Custom forwards ===

  private addForwards(pairs: { alias: string; dest: string }[]): void {
    const dont = pairs.map((p) => stdOf(p.alias)).find((s) => s?.tier === 'dont');
    if (dont) return this.dont(dont);
    const custom = pairs.filter((p) => !stdOf(p.alias));
    const one = custom.length === 1;
    const note = custom.length
      ? `<p>${custom.map((p) => mono(`${p.alias}@`)).join(', ')} ${one ? "isn't one" : "aren't"} of LF's standard addresses. That's fine: ${one ? 'it works' : 'they work'} like any other forward.</p>`
      : '';
    if (!this.enabled()) {
      const single = pairs.length === 1;
      this.plan(
        `${note}<p>Forwarding isn't on yet, so I'll turn it on with ${single ? 'this address' : 'these addresses'}. ${single ? 'It works' : 'They work'} as soon as you confirm.</p>`,
        [{ key: 'fwd.enable', payload: { aliases: pairs.map((p) => `${p.alias}@${ARROW}${p.dest}`) } }]
      );
      return;
    }
    this.plan(
      `${note}<p>Here's the change:</p>`,
      pairs.map((p) => ({ key: this.has(p.alias) ? 'fwd.editAlias' : 'fwd.addAlias', payload: p }))
    );
  }

  private askWhere(alias: string): void {
    this.asking = alias;
    this.bot(`<p>Where should ${mono(`${alias}@${DOMAIN}`)} go? Give me one or more email addresses.</p>`);
  }

  private otherDomain(all: string[]): void {
    const [first, ...to] = all;
    const [name, domain] = first.toLowerCase().split('@');
    const close = editDistance(domain, DOMAIN) <= 3;
    const lead = close
      ? `Did you mean ${mono(`${name}@${DOMAIN}`)}? I don't recognize ${mono(domain)}.`
      : `${mono(domain)} isn't the project's primary domain.`;
    this.bot(`<p>${lead} Email forwarding is only available on the primary domain, ${mono(DOMAIN)}.</p>`, {
      actions: [action(`Yes, forward ${name}@${DOMAIN}`, () => this.addForwards([{ alias: name, dest: to.join(', ') }]), true)],
    });
  }

  private remove(alias: string): void {
    if (!this.has(alias)) {
      this.bot(`<p>${mono(`${alias}@`)} isn't set up.</p>`);
      return;
    }
    this.plan("<p>Mail sent to it will bounce once it's removed.</p>", [{ key: 'fwd.deleteAlias', payload: { alias } }]);
  }

  // === Review against the standard ===

  private review(): void {
    if (!this.enabled()) {
      this.bot(`<p>Forwarding isn't on for ${mono(DOMAIN)} yet, so there's nothing to check. I can set up the standard addresses.</p>`, {
        actions: [action('Set up the standard addresses', () => this.standardForm(), true)],
      });
      return;
    }
    const findings = this.findings();
    const auto = this.forwards()
      .filter((f) => f.autoReply)
      .map((f) => mono(`${f.alias}@`));
    const autoLine = auto.length ? muted(`${auto.join(', ')} ${auto.length === 1 ? 'is an auto-reply' : 'are auto-replies'}, as the standard says.`) : '';
    if (!findings.length) {
      this.bot(`<p>Every address on ${mono(DOMAIN)} matches LF's standard.</p>${autoLine}`);
      return;
    }
    if (findings.every((f) => f.tone === 'info')) {
      const one = findings.length === 1;
      this.bot(
        `<p>Everything on ${mono(DOMAIN)} matches LF's standard, except ${findings.map((f) => mono(`${f.alias}@`)).join(', ')}, which ${one ? "isn't" : "aren't"} in it. The standard doesn't say to remove ${one ? 'it' : 'them'}, so I've left ${one ? 'it' : 'them'}. Tell me if you want ${one ? 'it' : 'them'} removed.</p>${autoLine}`
      );
      return;
    }
    const pill: Record<string, string> = {
      bad: '<b class="text-red-700">Not allowed.</b>',
      warn: '<b class="text-amber-700">Fix.</b>',
      info: '<b class="text-gray-600">Check.</b>',
    };
    const table = htmlTable(
      ['Address', "What's wrong", 'Suggested fix'],
      findings.map((f) => [mono(`${f.alias}@`), `${pill[f.tone]} ${esc(f.issue)}`, esc(f.fix)])
    );
    const ok = this.forwards()
      .filter((f) => !f.autoReply && !findings.some((x) => x.alias === f.alias))
      .map((f) => mono(`${f.alias}@`));
    const security = findings.some((f) => f.alias === 'security')
      ? muted(`For ${mono('security@')}, send me the responders, like "security@ → name@example.org, name2@example.org".`)
      : '';
    const tail = `${ok.length ? muted(`These match the standard: ${ok.join(', ')}.`) : ''}${autoLine}${security}${muted('Checked against the LF PMO standard alias template for new projects')}`;
    const changes = findings.filter((f) => f.change).map((f) => ({ key: f.change?.key ?? '', payload: f.change?.payload ?? {} }));
    if (!changes.length) {
      this.bot(`<p>Here's what doesn't match LF's standard:</p>${table}${tail}`);
      return;
    }
    this.plan(`<p>Here's what doesn't match LF's standard:</p>${table}${tail}<p>I can make these fixes now. Untick any you don't want:</p>`, changes);
  }

  private findingsFor(enabled: boolean, forwards: ItOsForward[]): ItOsForwardFinding[] {
    if (!enabled) return [];
    const out: ItOsForwardFinding[] = [];
    for (const f of forwards) {
      const s = stdOf(f.alias);
      if (f.autoReply) continue;
      if (s?.tier === 'dont') {
        out.push({
          alias: f.alias,
          tone: 'bad',
          issue: `The standard says not to create ${f.alias}@. Today it forwards to ${f.dest}.`,
          fix: `Make it an auto-reply that points people to ${s.instead}`,
          change: { key: 'fwd.autoReply', payload: { alias: f.alias, instead: s.instead ?? '' } },
        });
      } else if (s?.alias === 'security' && /@lists\./.test(f.dest)) {
        out.push({
          alias: f.alias,
          tone: 'warn',
          issue: `Goes to a mailing list, ${f.dest}. The standard says named people only.`,
          fix: 'Send it to the named security responders. Tell me who they are.',
        });
      } else if (s && !s.ask && !s.tbd && standardDestination(s.alias) && !sameDest(f.dest, standardDestination(s.alias))) {
        out.push({
          alias: f.alias,
          tone: 'warn',
          issue: `Goes to ${f.dest}. The standard sends it to ${standardDestination(s.alias)}.${s.note ? ` ${s.note}` : ''}`,
          fix: `Send it to ${standardDestination(s.alias)}`,
          change: { key: 'fwd.editAlias', payload: { alias: f.alias, dest: standardDestination(s.alias) } },
        });
      } else if (!s) {
        out.push({
          alias: f.alias,
          tone: 'info',
          issue: "Not in LF's standard. The standard doesn't say to remove it.",
          fix: 'Keep it, or ask me to remove it if no one uses it',
        });
      }
    }
    const has = (alias: string): boolean => forwards.some((f) => f.alias === alias);
    for (const s of tierOf('required').filter((x) => !x.tbd && !has(x.alias))) {
      out.push({
        alias: s.alias,
        tone: 'warn',
        issue: 'Required by the standard, but not set up.',
        fix: `Add it, going to ${standardDestination(s.alias)}`,
        change: { key: 'fwd.addAlias', payload: { alias: s.alias, dest: standardDestination(s.alias) } },
      });
    }
    return out;
  }

  private feeAnswer(): void {
    if (!this.staff()) {
      this.bot(`<p>${IT_OS_FORMATION_TEXT}</p>`);
      return;
    }
    this.bot(
      `<p>Forwarding on the project's first domain is included in the Essentials fee. Each additional domain with forwarding is ${IT_OS_FEES.forwardingExtraDomain}/mo.</p>${muted(esc(IT_OS_COST_NOTE))}`
    );
  }

  private has(alias: string): boolean {
    return this.forwards().some((f) => f.alias === alias);
  }
}
