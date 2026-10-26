// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';
import {
  IT_OS_COST_NOTE,
  IT_OS_DNS_ACTIONS,
  IT_OS_FEES,
  IT_OS_FORMATION_TEXT,
  IT_OS_LF_NAMESERVERS,
  IT_OS_PAYLOAD_LABELS,
  IT_OS_SAMPLE_DOMAINS,
  IT_OS_SAMPLE_PROJECT,
  IT_OS_WAITING_STATE,
} from '@lfx-one/shared/constants';
import {
  ItOsActionPayload,
  ItOsActionResult,
  ItOsChatAction,
  ItOsChatMessage,
  ItOsChatNote,
  ItOsDnsRecord,
  ItOsDomain,
  ItOsProposal,
  ItOsTransferForm,
  ItOsTransferProgress,
} from '@lfx-one/shared/interfaces';

import { esc, formatDate, htmlTable, listNames, mono, muted, notesHtml, plural, recordTable, toneIcon } from './it-os-dns-html';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const P = IT_OS_SAMPLE_PROJECT;
const THINK_MS = 500;
const STEP_MS = 420;

const cloneDomains = (): ItOsDomain[] => structuredClone(IT_OS_SAMPLE_DOMAINS);
const action = (label: string, run: () => void, primary = false): ItOsChatAction => ({ label, run, primary });
const byRegistrar = (domains: ItOsDomain[]): Record<string, string[]> =>
  domains.reduce<Record<string, string[]>>((groups, d) => ((groups[d.registrar] = groups[d.registrar] ?? []).push(d.name), groups), {});
const blockersOf = (d: ItOsDomain): string[] => [d.locked ? 'transfer lock' : '', d.dnssec ? 'DNSSEC' : ''].filter(Boolean);
const domainIn = (text: string): string | null => {
  const m = text.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:org|io|dev|com|net|foundation|tech|ai)\b/i);
  return m && !/github\.io$/i.test(m[0]) ? m[0].toLowerCase() : null;
};

/**
 * Scripted conversation engine for the IT OS Domains & DNS agent (#4257), ported from the UI prototype.
 * It matches messages against known intents and works on sample data held in memory; nothing reaches
 * ITX, DNSimple or a registrar. Changes that need LF IT approval get a sample request id instead of applying.
 */
@Injectable({ providedIn: 'root' })
export class ItOsDnsAgentService {
  public readonly messages = signal<ItOsChatMessage[]>([]);
  public readonly domains = signal<ItOsDomain[]>(cloneDomains());
  /** "Viewing as": LF staff see fee lines; external members are referred to the Formation Team. */
  public readonly staff = signal(true);
  public readonly busy = computed(() => this.messages().some((m) => m.typing || (m.steps !== undefined && (m.shown ?? 0) <= m.steps.length)));

  private transfers: Record<string, ItOsTransferProgress> = {};
  private nsTries = 0;
  private nextRequest = 1042;
  private nextRecordId = 5000;
  /** Bumped on reset so timers from the previous run are ignored. */
  private generation = 0;

  // === Conversation ===

  public start(): void {
    if (this.messages().length === 0) this.greet();
  }

  public reset(): void {
    this.generation++;
    this.domains.set(cloneDomains());
    this.messages.set([]);
    this.transfers = {};
    this.nsTries = 0;
    this.nextRequest = 1042;
    this.staff.set(true);
    this.greet();
  }

  public send(text: string): void {
    const value = text.trim();
    if (!value || this.busy()) return;
    this.push({ fromUser: true, text: value });
    this.think(() => this.route(value));
  }

  public runAction(message: ItOsChatMessage, chatAction: ItOsChatAction): void {
    if (message.used || this.busy()) return;
    message.used = true;
    this.push({ fromUser: true, text: chatAction.label });
    this.think(chatAction.run);
  }

  public togglePlan(proposal: ItOsProposal, on: boolean): void {
    proposal.on = on;
    this.refresh();
  }

  public cancelPlan(message: ItOsChatMessage): void {
    if (!message.plan) return;
    message.plan.state = 'cancelled';
    this.push({ fromUser: true, text: 'Cancel' });
    this.think(() => this.bot('<p>OK, nothing changed.</p>'));
  }

  public confirmPlan(message: ItOsChatMessage): void {
    const plan = message.plan;
    if (!plan) return;
    plan.state = 'done';
    plan.results = plan.proposals.filter((p) => p.on).map((p) => this.submit(p.key, p.payload));
    this.push({ fromUser: true, text: 'Confirm' });
    this.think(() => {
      const results = plan.results ?? [];
      const applied = results.filter((r) => !r.requestId);
      const requested = results.filter((r) => r.requestId);
      let html = applied.length ? `<p>Done: ${applied.map((r) => esc(r.title)).join('; ')}.</p>` : '';
      if (requested.length) {
        html += `<p>Sent to LF IT for approval: ${requested.map((r) => `${esc(r.title)} (${esc(r.requestId)})`).join('; ')}. LF IT reviews the request before anything changes.</p>`;
      }
      this.bot(html);
    });
  }

  /** Zone files from the registrar: only .txt files are accepted, as in PCC. */
  public uploadZoneFiles(message: ItOsChatMessage, fileNames: string[]): void {
    const upload = message.zoneUpload;
    if (!upload || !fileNames.length || this.busy()) return;
    message.used = true;
    this.push({ fromUser: true, text: `Uploaded ${fileNames.join(', ')}` });
    this.think(() => {
      if (fileNames.some((f) => !/\.txt$/i.test(f))) {
        this.bot('<p>Failed to read zone file. Please add a .txt extension to the file and try again.</p>', { zoneUpload: upload });
        return;
      }
      upload.need.forEach((name, i) => {
        if (i < fileNames.length) {
          this.progress(name).zone?.push(
            { id: this.recordId(), type: 'CNAME', name: 'tickets', content: 'tickets.example-ticketing.com', ttl: 3600 },
            { id: this.recordId(), type: 'TXT', name: '@', content: 'google-site-verification=Qx81mZ', ttl: 3600 }
          );
        }
      });
      this.bot(`<p>Valid ${fileNames.length === 1 ? 'zone file' : 'zone files'}. They had records I couldn't see publicly, so I added them.</p>`, {
        actions: [action('Looks right, copy them', () => this.transferNs(upload.names, upload.need), true)],
      });
    });
  }

  // === Plan details (used by the template) ===

  public describe(proposal: ItOsProposal): string {
    return IT_OS_DNS_ACTIONS[proposal.key].describe(proposal.payload);
  }

  public needsApproval(proposal: ItOsProposal): boolean {
    return IT_OS_DNS_ACTIONS[proposal.key].needsApproval(proposal.payload);
  }

  public reason(proposal: ItOsProposal): string {
    return IT_OS_DNS_ACTIONS[proposal.key].reason(proposal.payload);
  }

  public cost(proposal: ItOsProposal): string | null {
    if (!IT_OS_DNS_ACTIONS[proposal.key].addsDomainFee) return null;
    return this.staff() ? `+${IT_OS_FEES.perDomain}/mo to the Essentials fee` : IT_OS_FORMATION_TEXT;
  }

  public details(payload: ItOsActionPayload): { label: string; value: string }[] {
    return (Object.keys(IT_OS_PAYLOAD_LABELS) as (keyof ItOsActionPayload)[])
      .filter((key) => payload[key] !== undefined && payload[key] !== '')
      .map((key) => {
        const value = payload[key];
        return { label: IT_OS_PAYLOAD_LABELS[key] ?? key, value: Array.isArray(value) ? value.join(', ') : String(value) };
      });
  }

  public domainBy(name: string): ItOsDomain | undefined {
    return this.domains().find((d) => d.name === name);
  }

  // === Message plumbing ===

  private push(message: ItOsChatMessage): void {
    this.messages.update((list) => [...list, message]);
  }

  private bot(html: string, extra: Partial<ItOsChatMessage> = {}): void {
    this.push({ fromUser: false, html, ...extra });
  }

  private plan(html: string, proposals: Omit<ItOsProposal, 'on'>[]): void {
    this.bot(html, { plan: { proposals: proposals.map((p) => ({ ...p, on: true })), state: 'open' } });
  }

  /** Re-emit after a nested change (a toggled proposal, a step shown) so the view updates. */
  private refresh(): void {
    this.messages.update((list) => [...list]);
    this.domains.update((list) => [...list]);
  }

  private later(fn: () => void, ms: number): void {
    const generation = this.generation;
    setTimeout(() => {
      if (generation === this.generation) fn();
    }, ms);
  }

  private think(fn: () => void): void {
    const typing: ItOsChatMessage = { fromUser: false, typing: true };
    this.push(typing);
    this.later(() => {
      this.messages.update((list) => list.filter((m) => m !== typing));
      fn();
      this.refresh();
    }, THINK_MS);
  }

  /** Shows progress steps one at a time, then runs `then`. */
  private work(html: string, steps: string[], then: () => void): void {
    const message: ItOsChatMessage = { fromUser: false, html, steps, shown: 1 };
    this.push(message);
    const tick = (): void => {
      message.shown = (message.shown ?? 1) + 1;
      if ((message.shown ?? 0) <= steps.length) {
        this.refresh();
        this.later(tick, STEP_MS);
      } else {
        then();
        this.refresh();
      }
    };
    this.later(tick, STEP_MS);
  }

  // === Data helpers ===

  private managed(): ItOsDomain[] {
    return this.domains().filter((d) => d.registrar === 'DNSimple');
  }

  private transferable(): ItOsDomain[] {
    return this.domains().filter((d) => d.registrar !== 'DNSimple');
  }

  private waiting(): ItOsDomain[] {
    return this.domains().filter((d) => d.state === IT_OS_WAITING_STATE || d.state === 'Transfer failed');
  }

  private domain(name: string): ItOsDomain {
    const found = this.domainBy(name);
    if (found) return found;
    const added: ItOsDomain = {
      name,
      registrar: 'Current registrar',
      dns: 'External',
      dnsAtRegistrar: false,
      ns: ['ns1.example-dns-host.net', 'ns2.example-dns-host.net'],
      expires: '2027-05-01',
      autoRenew: true,
      locked: false,
      dnssec: false,
      state: IT_OS_WAITING_STATE,
      uses: [],
      records: null,
      publicRecords: [
        { id: 0, type: 'A', name: '@', content: '203.0.113.5', ttl: 3600 },
        { id: 0, type: 'CNAME', name: 'www', content: name, ttl: 3600 },
      ],
    };
    this.domains.update((list) => [...list, added]);
    return added;
  }

  private progress(name: string): ItOsTransferProgress {
    return (this.transfers[name] = this.transfers[name] ?? { manage: 'yes', zone: null });
  }

  private recordId(): number {
    return this.nextRecordId++;
  }

  // === Applying changes ===

  private submit(key: string, payload: ItOsActionPayload): ItOsActionResult {
    const policy = IT_OS_DNS_ACTIONS[key];
    const title = policy.describe(payload);
    if (policy.needsApproval(payload)) return { title, requestId: `REQ-${this.nextRequest++}` };
    this.apply(key, payload);
    return { title };
  }

  private apply(key: string, p: ItOsActionPayload): void {
    const d = this.domainBy(p.domain);
    const record: ItOsDnsRecord = {
      id: p.id ?? this.recordId(),
      type: p.type ?? '',
      name: p.name ?? '',
      content: p.content ?? '',
      ttl: p.ttl ?? 3600,
      prio: p.prio,
    };
    switch (key) {
      case 'dns.addRecord':
      case 'dns.editRecord':
      case 'dns.changeMailOrNs': {
        if (!d) return;
        const records = d.records ?? (d.records = []);
        const existing = p.id ? records.find((r) => r.id === p.id) : undefined;
        if (existing) Object.assign(existing, record);
        else records.push(record);
        break;
      }
      case 'dns.deleteRecord':
        if (d?.records) d.records = d.records.filter((r) => r.id !== p.id);
        break;
      case 'domain.register':
        this.domains.update((list) => [
          ...list,
          {
            name: p.domain,
            registrar: 'DNSimple',
            dns: 'DNSimple',
            ns: [...IT_OS_LF_NAMESERVERS],
            expires: '2027-10-26',
            autoRenew: true,
            locked: true,
            state: 'Registered',
            uses: [],
            records: [],
          },
        ]);
        break;
      case 'domain.transfer':
        if (d) d.state = 'Transfer pending';
        break;
      case 'domain.autoRenew':
        if (d) d.autoRenew = !!p.on;
        break;
    }
  }

  // === Greeting and intents ===

  private greet(): void {
    const m = this.managed();
    const w = this.waiting();
    const pending = this.transferable().filter((d) => d.state === 'Transfer pending');
    let html = `<p>LF manages <b>${m.length} domains</b> for ${esc(P.name)}. All of them auto-renew.</p>`;
    if (w.length) {
      html += `<p><b>${plural(w.length, 'domain')}</b> ${w.length === 1 ? 'was' : 'were'} added to the project but ${w.length === 1 ? "hasn't" : "haven't"} moved to LF yet, at ${plural(Object.keys(byRegistrar(w)).length, 'registrar')}: ${listNames(w.map((d) => d.name))}.</p>`;
    }
    if (pending.length) html += `<p>${plural(pending.length, 'transfer')} in progress: ${listNames(pending.map((d) => d.name))}.</p>`;
    if (!w.length && !pending.length) html += '<p>Every domain is with LF. If the project owns another one, tell me its name.</p>';
    const actions = w.length
      ? [
          action(w.length === 1 ? `Transfer ${w[0].name}` : `Transfer all ${w.length}`, () => this.transferStart(w.map((d) => d.name)), true),
          ...(w.length > 1 ? [action('Choose which ones', () => this.chooseTransfers())] : []),
        ]
      : [];
    this.bot(html, { actions });
  }

  private route(text: string): void {
    const t = text.toLowerCase();
    const named = domainIn(text);
    const namedDomain = named ? this.domainBy(named) : undefined;

    if (/auto.?renew/.test(t) || /\b(stop|cancel|don.?t)\s+renew/.test(t)) {
      const d = namedDomain ?? this.domain(P.primaryDomain);
      const off = /\boff\b|disable|stop|cancel/.test(t);
      return this.plan(
        off
          ? `<p>Every LF domain auto-renews as a standard, so turning it off for ${mono(d.name)} goes to LF IT. Here's the request:</p>`
          : "<p>Here's the change:</p>",
        [{ key: 'domain.autoRenew', payload: { domain: d.name, on: !off } }]
      );
    }
    if (/cost|price|how much|pay|fee/.test(t)) return this.feeAnswer(t);
    if (/where|status|how.?s|progress/.test(t) && /transfer/.test(t)) return this.transferStatus();
    const month = MONTHS.findIndex((m) => t.includes(m));
    if (/renew|expir/.test(t) && month > -1) return this.renewalsIn(month);
    if (/how many|count|total/.test(t)) return this.domainCounts();
    if (/approv/.test(t)) {
      return this.bot(
        "<p>Registering and transferring domains don't need approval, and neither does pointing a waiting domain's nameservers at LF during its transfer. These go to LF IT: turning auto-renew off, moving nameservers away from LF, adding or changing MX or NS records, and deleting MX, NS or TXT records.</p>"
      );
    }
    if (/nameserver|\bns\b|cloudflare/.test(t) && namedDomain?.dns === 'DNSimple') {
      return this.plan(
        `<p>Moving ${mono(namedDomain.name)} away from LF's nameservers goes to LF IT. Its URL redirects and other LF-hosted records stop working unless they're recreated at the new host.</p>`,
        [{ key: 'domain.delegation', payload: { domain: namedDomain.name, ns: ['ns1.new-dns-host.example', 'ns2.new-dns-host.example'] } }]
      );
    }
    if (/record|point|cname|txt|verif|dmarc|github pages|\b\d{1,3}(\.\d{1,3}){3}\b/.test(t)) return this.recordChange(namedDomain, text);
    if (/transfer|move/.test(t)) {
      if (named) {
        if (!namedDomain) return this.checkDomain(named);
        return namedDomain.registrar === 'DNSimple' ? this.bot(`<p>${mono(named)} is already with LF.</p>`) : this.transferStart([named]);
      }
      const w = this.waiting();
      if (w.length) return /choose|pick|some|which/.test(t) ? this.chooseTransfers() : this.transferStart(w.map((d) => d.name));
      return this.bot('<p>Every domain is with LF. If the project owns another one, tell me its name.</p>');
    }
    if (/waiting|show|list/.test(t)) {
      const w = this.waiting();
      return w.length ? this.domainList(w, `${plural(w.length, 'domain')} waiting to move to LF:`) : this.bot('<p>Nothing is waiting to transfer.</p>');
    }
    if (named) return this.checkDomain(named);
    this.bot(
      `<p>Tell me a domain and I'll work out whether to register it, transfer it, or change its DNS. I can also answer questions across all your domains, like "which domains renew in March?".</p>`
    );
  }

  private feeAnswer(t: string): void {
    if (!this.staff()) return this.bot(`<p>${IT_OS_FORMATION_TEXT}</p>`);
    const w = this.waiting();
    const all = this.domains().length;
    if (/transfer/.test(t) && w.length) {
      return this.bot(
        `<p>Each domain added to the project counts toward the Essentials fee at <b>${IT_OS_FEES.perDomain}/mo</b>, including the ${plural(w.length, 'domain')} still waiting to transfer. The fee schedule doesn't list a one-time transfer cost, so LF IT can confirm that. Transfers don't need approval.</p>${muted(esc(IT_OS_COST_NOTE))}`
      );
    }
    this.bot(
      `<p>Domains are covered by the Essentials fee: ${IT_OS_FEES.essentialsBase}/mo base plus ${IT_OS_FEES.perDomain}/mo per domain. Every domain added to the project in LFX counts, even before it transfers, so ${all} domains count today. The fee also covers email forwarding on the first domain, monitoring and identity.</p>${muted(esc(IT_OS_COST_NOTE))}`
    );
  }

  private transferStatus(): void {
    const ds = this.transferable();
    if (!ds.length) return this.bot('<p>No transfers in progress. Every domain is with LF.</p>');
    const groups = ds.reduce<Record<string, string[]>>((m, d) => ((m[d.state] = m[d.state] ?? []).push(d.name), m), {});
    const pending = ds.some((d) => d.state === 'Transfer pending')
      ? '<p>For pending transfers, check your email so that you can approve them. Transfers usually take about a week.</p>'
      : '';
    this.bot(
      `<ul>${Object.entries(groups)
        .map(([state, names]) => `<li><b>${esc(state)}</b>: ${listNames(names)}</li>`)
        .join('')}</ul>${pending}`
    );
  }

  private renewalsIn(month: number): void {
    const ds = this.managed()
      .filter((d) => +d.expires.slice(5, 7) === month + 1)
      .sort((a, b) => a.expires.localeCompare(b.expires));
    const label = MONTHS[month][0].toUpperCase() + MONTHS[month].slice(1);
    if (!ds.length) return this.bot('<p>No domains renew that month.</p>');
    this.domainList(ds, `${plural(ds.length, 'domain')} renew${ds.length === 1 ? 's' : ''} in ${label}, all automatically:`);
  }

  private domainCounts(): void {
    const m = this.managed();
    const uses = m.reduce<Record<string, number>>((acc, d) => {
      const use = d.uses[0] ?? 'Not in use';
      acc[use] = (acc[use] ?? 0) + 1;
      return acc;
    }, {});
    const transferring = this.transferable().filter((d) => d.state === 'Transfer pending').length;
    this.bot(
      `<p>${esc(P.name)} has <b>${this.domains().length} domains</b>: ${m.length} with LF, ${this.waiting().length} waiting to transfer, ${transferring} transferring.</p><ul>${Object.entries(
        uses
      )
        .sort((a, b) => b[1] - a[1])
        .map(([use, count]) => `<li>${esc(use)}: ${count}</li>`)
        .join('')}</ul>`
    );
  }

  private domainList(ds: ItOsDomain[], intro: string): void {
    const shown = ds.slice(0, 12);
    const rows = shown.map((d) => [mono(d.name), esc(d.uses.join(', ') || '—'), d.registrar === 'DNSimple' ? `Renews ${formatDate(d.expires)}` : esc(d.state)]);
    const more = ds.length > shown.length ? muted(`Showing ${shown.length} of ${ds.length}. See them all on the Details tab.`) : '';
    this.bot(`<p>${intro}</p>${htmlTable(['Domain', 'Used for', 'Status'], rows)}${more}`);
  }

  private checkDomain(name: string): void {
    this.work(`<p>Checking ${mono(name)}…</p>`, ['Checked whether it is available', 'Checked whether another LF project owns it'], () => {
      const d = this.domainBy(name);
      if (d?.registrar === 'DNSimple') {
        return this.bot(
          `<p>${mono(name)} is already with LF and auto-renews. What do you want to change? For example, "point blog at our GitHub Pages site".</p>`
        );
      }
      if (d) return this.transferStart([name]);
      if (/taken|google|linux|kubernetes/.test(name)) {
        return this.bot(`<p>${mono(name)} is registered by someone else. Do you own this domain, or know its owners?</p>`, {
          actions: [
            action(
              'Yes, transfer it',
              () => {
                this.domain(name);
                this.transferStart([name]);
              },
              true
            ),
            action('No', () => this.bot('<p>To buy it from its current owners through an escrow service, contact support.</p>')),
          ],
        });
      }
      const fee = this.staff() ? `Registering it adds ${IT_OS_FEES.perDomain}/mo to the project's Essentials fee. ` : '';
      this.plan(`<p>${mono(name)} is available. ${fee}It will auto-renew. Availability is simulated in this prototype.</p>`, [
        { key: 'domain.register', payload: { domain: name } },
      ]);
    });
  }

  private recordChange(named: ItOsDomain | undefined, text: string): void {
    const d = named?.registrar === 'DNSimple' && named.records ? named : this.domain(P.primaryDomain);
    const { notes, proposals } = this.recordsPlan(d, text);
    if (!proposals.length) {
      return this.bot(
        notesHtml(notes) ||
          `<p>I couldn't tell which record you need on ${mono(d.name)}. Try something like "point blog at 192.0.2.50" or "add the TXT record google-site-verification=…".</p>`
      );
    }
    this.plan(`<p>Here's what I'd change on ${mono(d.name)}:</p>${notesHtml(notes)}`, proposals);
  }

  private recordsPlan(d: ItOsDomain, goal: string): { notes: ItOsChatNote[]; proposals: Omit<ItOsProposal, 'on'>[] } {
    const notes: ItOsChatNote[] = [];
    const proposals: Omit<ItOsProposal, 'on'>[] = [];
    const records = d.records ?? [];
    const sub = goal.match(new RegExp(`\\b([a-z0-9-]+)\\.${d.name.replace(/\./g, '\\.')}`, 'i'))?.[1] ?? goal.match(/\b(?:point|make)\s+([a-z0-9-]+)\b/i)?.[1];
    const name = sub && !/^(the|our|it|this|a|an)$/i.test(sub) ? sub.toLowerCase() : null;

    // Pantheon multisite: only the primary domain points at Pantheon.
    if (/pantheon/i.test(goal)) {
      const target = name ?? 'www';
      const fee = this.staff() ? ` (${IT_OS_FEES.pantheonMultisite}/mo)` : '';
      notes.push({
        tone: 'warn',
        text: `Only ${P.primaryDomain} points at Pantheon. Pointing ${target} there too would count as another Pantheon multisite site${fee}. I suggest a URL redirect to ${P.primaryDomain} instead.`,
      });
      proposals.push({ key: 'dns.addRecord', payload: { domain: d.name, type: 'URL', name: target, content: `https://${P.primaryDomain}`, ttl: 3600 } });
      return { notes, proposals };
    }

    const found: { type: string; name: string; content: string }[] = [];
    if (/github\s*pages|\.github\.io/i.test(goal)) found.push({ type: 'CNAME', name: name ?? 'docs', content: `${P.githubOrg}.github.io` });
    const ip = goal.match(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    if (ip) found.push({ type: 'A', name: name ?? '@', content: ip[0] });
    const verification = goal.match(/google-site-verification=[\w-]+/i);
    if (verification) found.push({ type: 'TXT', name: '@', content: verification[0] });
    if (/dmarc/i.test(goal) && !records.some((r) => r.name === '_dmarc')) found.push({ type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=quarantine' });
    if (/verif/i.test(goal) && !verification) {
      notes.push({
        tone: 'warn',
        text: "You mentioned verification but didn't include the value. Paste the full record value from the service that asked for it.",
      });
    }

    found.forEach((r) => {
      const existing = records.find((x) => x.name === r.name && x.type === r.type && r.type !== 'TXT');
      if (r.type === 'CNAME' && records.some((x) => x.name === r.name && x.type !== 'CNAME')) {
        notes.push({ tone: 'warn', text: `${r.name} already has other records, and a CNAME can't share a name with them.` });
      }
      const payload: ItOsActionPayload = { domain: d.name, type: r.type, name: r.name, content: r.content, ttl: 3600 };
      if (existing) {
        payload.id = existing.id;
        notes.push({ tone: 'info', text: `${r.type} ${r.name} already points to ${existing.content}. I'll replace it.` });
      }
      proposals.push({ key: existing ? 'dns.editRecord' : 'dns.addRecord', payload });
    });
    return { notes, proposals };
  }

  // === Transfers (one domain or many) ===

  private chooseTransfers(): void {
    const w = this.waiting();
    const picker = { domains: w, picks: Object.fromEntries(w.map((d) => [d.name, true])) };
    this.bot('<p>Pick the domains to transfer now:</p>', {
      picker,
      actions: [
        action(
          'Transfer selected',
          () => {
            const names = Object.entries(picker.picks)
              .filter(([, on]) => on)
              .map(([n]) => n);
            if (!names.length) return this.bot('<p>Pick at least one domain.</p>');
            this.transferStart(names);
          },
          true
        ),
      ],
    });
  }

  private transferStart(names: string[]): void {
    const n = names.length;
    this.work(
      `<p>Checking ${n === 1 ? mono(names[0]) : `${n} domains`} before we start…</p>`,
      [
        n === 1 ? `Looked up ${names[0]} at its registrar` : `Looked up ${n} domains at their registrars`,
        'Checked transfer locks and DNSSEC',
        'Read public DNS records',
        'Checked where email goes',
      ],
      () => this.transferVerdict(names)
    );
  }

  private transferVerdict(names: string[]): void {
    const ds = names.map((n) => this.domain(n));
    const blocked = ds.filter((d) => blockersOf(d).length);
    const ready = ds.filter((d) => !blockersOf(d).length);
    const mail = ds.filter((d) => d.dnsAtRegistrar && d.dns !== 'DNSimple' && (d.publicRecords ?? []).some((r) => r.type === 'MX'));
    const dnsHost = (d: ItOsDomain): string => {
      if (d.dns === 'DNSimple') return 'LF';
      return d.dnsAtRegistrar ? `${toneIcon('warn')} Registrar` : 'Elsewhere';
    };
    let html = htmlTable(
      ['Domain', 'Registrar', 'Lock off', 'DNSSEC off', 'DNS host'],
      ds.map((d) => [mono(d.name), esc(d.registrar), toneIcon(d.locked ? 'bad' : 'ok'), toneIcon(d.dnssec ? 'bad' : 'ok'), dnsHost(d)])
    );
    if (blocked.length) {
      const groups = byRegistrar(blocked);
      html += `<p><b>${plural(blocked.length, 'domain')} need${blocked.length === 1 ? 's' : ''} a fix first.</b></p><ul>${Object.entries(groups)
        .map(
          ([registrar, ns]) =>
            `<li>At ${esc(registrar)}: ${ns.map((n) => `${mono(n)} (turn off the ${blockersOf(this.domain(n)).join(' and ')})`).join(', ')}</li>`
        )
        .join('')}</ul>${muted('Registrars also call the transfer lock domain lock or registrar lock.')}`;
    } else {
      html += `<p><b>Nothing blocks ${names.length === 1 ? 'the transfer' : `these ${names.length} transfers`}.</b></p>`;
    }
    const forwarded = ds.filter((d) => d.regForwarding && d.dns !== 'DNSimple');
    if (forwarded.length) {
      html += `<p>Heads-up: ${listNames(forwarded.map((d) => d.name))} redirect${forwarded.length === 1 ? 's' : ''} using the registrar's URL forwarding, which stops when DNS moves. I'll recreate ${forwarded.length === 1 ? 'it' : 'them'} as URL records in LF's DNS instead of copying the forwarding records.</p>`;
    }
    if (mail.length) {
      html += `<p>Heads-up: mail for ${listNames(mail.map((d) => d.name))} goes to the registrar's mail service, which may stop once the domain leaves. Plan where that mail should go.</p>`;
    }
    const recheck = action(
      `I've fixed ${blocked.length === 1 ? 'it' : 'them'}, check again`,
      () => {
        blocked.forEach((d) => {
          d.locked = false;
          d.dnssec = false;
        });
        this.transferStart(names);
      },
      !ready.length
    );
    if (blocked.length && ready.length) {
      return this.bot(html, { actions: [action(`Continue with the ${ready.length} ready`, () => this.transferDns(ready.map((d) => d.name)), true), recheck] });
    }
    if (blocked.length) return this.bot(html, { actions: [recheck] });
    this.bot(html);
    this.transferDns(names);
  }

  private transferDns(names: string[]): void {
    const need = names.filter((n) => this.domain(n).dns !== 'DNSimple' && this.progress(n).manage !== 'no');
    if (!need.length) return this.transferCode(names);
    need.forEach((n) => {
      const x = this.progress(n);
      const d = this.domain(n);
      if (x.zone) return;
      x.zone = d.regForwarding
        ? [
            { id: this.recordId(), type: 'URL', name: '@', content: d.regForwarding, ttl: 3600 },
            { id: this.recordId(), type: 'URL', name: 'www', content: d.regForwarding, ttl: 3600 },
          ]
        : (d.publicRecords ?? []).map((r) => ({ ...r, id: this.recordId() }));
    });
    const total = need.reduce((sum, n) => sum + (this.progress(n).zone?.length ?? 0), 0);
    const body =
      need.length === 1
        ? recordTable(this.progress(need[0]).zone ?? [])
        : htmlTable(
            ['Domain', 'Records'],
            need.map((n) => [mono(n), String(this.progress(n).zone?.length ?? 0)])
          );
    const copy = action('Looks right, copy them', () => this.transferNs(names, need), true);
    this.bot(
      `<p>So sites and email keep working, I'll copy ${plural(total, 'DNS record')}${need.length > 1 ? ` across ${need.length} domains` : ''} to LF's DNS before the transfer. That includes every MX, TXT and DKIM record:</p>${body}${muted(
        'I can only see records that are published publicly. If you have zone files from the registrar, upload them so nothing is missed.'
      )}`,
      {
        zoneUpload: { names, need },
        actions: [
          copy,
          ...(need.length > 1
            ? [
                action('Show every record', () =>
                  this.bot(need.map((n) => `<p><b>${esc(n)}</b></p>${recordTable(this.progress(n).zone ?? [])}`).join(''), { actions: [copy] })
                ),
              ]
            : []),
          action('Keep current DNS hosts', () => this.keepDns(names, need)),
        ],
      }
    );
  }

  private keepDns(names: string[], need: string[]): void {
    const atRegistrar = need.filter((n) => this.domain(n).dnsAtRegistrar);
    const note = muted("Without LF-managed DNS, email forwarding, URL redirects and automated service setup won't be available.");
    if (atRegistrar.length) {
      return this.bot(
        `<p>DNS for ${listNames(atRegistrar)} is hosted by the registrar you're leaving. If you keep it there, those sites and email will go down after the transfer. Move DNS to another host first, or let LF manage it.</p>${note}`,
        {
          actions: [
            action('Let LF manage DNS', () => this.transferNs(names, need), true),
            action("I've moved DNS to another host", () => {
              need.forEach((n) => (this.progress(n).manage = 'no'));
              this.transferCode(names);
            }),
          ],
        }
      );
    }
    need.forEach((n) => (this.progress(n).manage = 'no'));
    this.bot(`<p>OK, DNS stays where it is.</p>${note}`);
    this.transferCode(names);
  }

  private transferNs(names: string[], need: string[]): void {
    const groups = byRegistrar(need.map((n) => this.domain(n)));
    const where = need.length === 1 ? `for ${mono(need[0])} at ${esc(this.domain(need[0]).registrar)}` : 'at each registrar';
    const perRegistrar =
      need.length > 1
        ? `<ul>${Object.entries(groups)
            .map(([registrar, ns]) => `<li>At ${esc(registrar)}: ${ns.map(mono).join(', ')}</li>`)
            .join('')}</ul>`
        : '';
    this.bot(
      `<p>Records are ready in LF's DNS. Now change the nameservers ${where} to the four below. This is part of the transfer, so it doesn't need LF IT approval.</p>${perRegistrar}`,
      { nameservers: true }
    );
    this.bot("<p>Tell me when you've changed them. It can take over an hour to spread.</p>", {
      actions: [action('Done, check delegation', () => this.verifyNs(names, need), true)],
    });
  }

  private verifyNs(names: string[], need: string[]): void {
    this.work('', [`Checked which nameservers answer for ${need.length === 1 ? need[0] : `${need.length} domains`}`], () => {
      const tries = ++this.nsTries;
      // Prototype: one domain is slow to spread on the first check.
      const late = tries === 1 ? need.slice(-1) : [];
      need
        .filter((n) => !late.includes(n))
        .forEach((n) =>
          Object.assign(this.domain(n), { ns: [...IT_OS_LF_NAMESERVERS], dns: 'DNSimple', records: (this.progress(n).zone ?? []).map((r) => ({ ...r })) })
        );
      if (late.length) {
        const done = need.length > 1 ? `${need.length - late.length} of ${need.length} are delegated. ` : '';
        return this.bot(
          `<p>${done}Not yet for ${listNames(late)}: it still points to ${mono(this.domain(late[0]).ns[0])}. If you just changed it, give it some time.</p>`,
          { actions: [action('Check again', () => this.verifyNs(names, late), true)] }
        );
      }
      this.bot(`<p>Delegation verified. LF's DNS now answers for ${need.length === 1 ? mono(need[0]) : `all ${need.length}`}.</p>`);
      this.transferCode(names);
    });
  }

  private transferCode(names: string[]): void {
    const form: ItOsTransferForm = {
      names,
      codes: Object.fromEntries(names.map((n) => [n, ''])),
      attestUnlocked: false,
      attestDnsElsewhere: false,
      askDnsElsewhere: names.some((n) => this.progress(n).manage === 'no'),
    };
    const fee = this.staff() ? `Each domain adds ${IT_OS_FEES.perDomain}/mo to the Essentials fee.` : IT_OS_FORMATION_TEXT;
    this.bot(
      `<p>Last step: I need the transfer code${names.length > 1 ? ' for each domain' : ''} (also called the authorization or EPP code) from the registrar. This is a prototype, so don't enter a real code.</p>${muted(
        `Applies immediately: moving project domains to LF is a required setup step. ${esc(fee)}`
      )}`,
      { transferForm: form, actions: [action(names.length > 1 ? `Begin ${names.length} transfers` : 'Begin transfer', () => this.beginTransfer(form), true)] }
    );
  }

  private beginTransfer(form: ItOsTransferForm): void {
    const { names } = form;
    const missing = names.filter((n) => !form.codes[n]?.trim());
    const short = names.filter((n) => form.codes[n]?.trim() && form.codes[n].trim().length < 6);
    let error = '';
    if (missing.length) error = `I still need the transfer code for ${listNames(missing)}.`;
    else if (short.length) error = `Authorization code not valid for ${listNames(short)}. Check it at the registrar and try again.`;
    else if (!form.attestUnlocked || (form.askDnsElsewhere && !form.attestDnsElsewhere)) error = 'Please confirm the statements above first.';
    if (error) {
      this.bot(`<p>${error}</p>`);
      return this.transferCode(names);
    }
    names.forEach((n) => this.submit('domain.transfer', { domain: n }));
    const many = names.length > 1;
    this.bot(
      `<p><b>${many ? `${names.length} transfers started.` : 'Transfer started.'}</b> Check your email so that you can approve the transfer${many ? 's' : ''}. The message goes to the contact on file at each registrar. Transfers usually take about a week.</p><p>You can leave this page and ask me any time.</p>${muted(
        '<b>Prototype only:</b> skip ahead a week.'
      )}`,
      {
        actions: [
          action(many ? 'Show them completing' : 'Show a completed transfer', () => this.transferDone(names, []), true),
          action(many ? 'Show one failing' : 'Show a failed transfer', () => this.transferDone(names.slice(1), names.slice(0, 1))),
        ],
      }
    );
  }

  private transferDone(okNames: string[], failed: string[]): void {
    okNames.forEach((n) => {
      const d = this.domain(n);
      Object.assign(d, { registrar: 'DNSimple', state: 'Registered', locked: true, autoRenew: true });
      if (!d.records && d.dns === 'DNSimple') d.records = (this.progress(n).zone ?? []).map((r) => ({ ...r }));
    });
    failed.forEach((n) => Object.assign(this.domain(n), { state: 'Transfer failed', locked: true }));
    let html = okNames.length
      ? `<p><b>${okNames.length > 1 ? `${okNames.length} domains are` : `${mono(okNames[0])} is`} with the Linux Foundation now.</b> Registered through DNSimple, and auto-renew is on.</p>`
      : '';
    if (failed.length) {
      const d = this.domain(failed[0]);
      const down = d.dns === 'DNSimple' ? 'Its DNS is already with LF, so nothing is down.' : 'Its DNS is still at its current host.';
      html += `<p><b>Transfer failed</b> for ${mono(failed[0])}: the registry reported ${mono('clientTransferProhibited')}. That means ${esc(d.registrar)} turned the transfer lock back on. Unlock it again and get a new transfer code, then I'll retry. ${down}</p>`;
      return this.bot(html, {
        actions: [
          action(
            "I've unlocked it, retry",
            () => {
              d.locked = false;
              d.state = IT_OS_WAITING_STATE;
              this.transferStart(failed);
            },
            true
          ),
        ],
      });
    }
    const left = this.waiting();
    const rest = left.length
      ? `<p>${plural(left.length, 'domain')} still need${left.length === 1 ? 's' : ''} to move: ${listNames(left.map((x) => x.name))}.</p>`
      : '';
    this.bot(html + rest, {
      actions: left.length
        ? [
            action(
              left.length === 1 ? `Transfer ${left[0].name}` : `Transfer the other ${left.length}`,
              () => this.transferStart(left.map((x) => x.name)),
              true
            ),
          ]
        : [],
    });
  }
}
