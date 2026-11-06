// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal } from '@angular/core';
import {
  IT_OS_BULK_SAMPLE,
  IT_OS_COST_NOTE,
  IT_OS_FEES,
  IT_OS_FORMATION_TEXT,
  IT_OS_LIST_PERMISSION_TEXT,
  IT_OS_LISTS_HOST,
  IT_OS_MAILING_LIST_ACTIONS,
  IT_OS_MAILING_LIST_PAYLOAD_LABELS,
  IT_OS_MAILING_LIST_SUGGESTIONS,
  IT_OS_SAMPLE_COMMITTEES,
  IT_OS_SAMPLE_LISTS,
  IT_OS_SAMPLE_PROJECT,
  IT_OS_SAMPLE_STAFF,
  IT_OS_SYNC_LABELS,
} from '@lfx-one/shared/constants';
import { ItOsChangePayload, ItOsChatForm, ItOsChatNote, ItOsCommittee, ItOsMailingList, ItOsScenario, ItOsSyncDiff } from '@lfx-one/shared/interfaces';

import { action, ItOsChatEngine } from './it-os-chat-engine';
import { esc, htmlTable, mono, muted, notesHtml, plural } from './it-os-dns-html';

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_EMAILS = /[^\s@,<>]+@[^\s@,<>]+\.[a-z]{2,}/gi;
const RE_SUBLIST =
  /(?:create|new|make|add)\s+(?:a\s+)?(private\s+|public\s+)?(?:sub-?\s?list|sub-?group|(?:mailing\s+)?list)(?:\s+(?:called|named|for))?\s+([a-z0-9._-]+)/i;
const staffOf = (email: string): { name: string; role: string } | undefined => {
  if (IT_OS_SAMPLE_STAFF.ed.email === email) return { name: IT_OS_SAMPLE_STAFF.ed.name, role: 'executive director' };
  const pm = IT_OS_SAMPLE_STAFF.pms.find((p) => p.email === email);
  return pm ? { name: pm.name, role: 'program manager' } : undefined;
};
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toLowerCase();

/**
 * Mailing List agent (#4257): creates sub-lists on groups.io, adds subscribers in bulk and keeps lists in
 * sync with committees. Sync rules follow LF's PCC committee mailing list sync docs. Sample data only;
 * nothing reaches groups.io.
 */
@Injectable({ providedIn: 'root' })
export class ItOsMailingListAgentService extends ItOsChatEngine {
  public readonly scenarios: ItOsScenario[] = [];
  public readonly host = IT_OS_LISTS_HOST;
  public readonly lists = signal<ItOsMailingList[]>([]);
  public readonly committees = signal<ItOsCommittee[]>([]);

  protected readonly policies = IT_OS_MAILING_LIST_ACTIONS;
  protected readonly payloadLabels = IT_OS_MAILING_LIST_PAYLOAD_LABELS;

  public constructor() {
    super();
    this.resetData();
  }

  public suggestions(): string[] {
    return IT_OS_MAILING_LIST_SUGGESTIONS;
  }

  /** Status for the agent card. */
  public status(): { ok: boolean; text: string } {
    const n = this.outOfSync().length;
    if (n) return { ok: false, text: `${plural(n, 'list')} out of sync with ${n === 1 ? 'its committee' : 'committees'}` };
    return { ok: true, text: `${plural(this.lists().length, 'list')}, all in sync` };
  }

  /** main first, then its sub-lists. */
  public ordered(): ItOsMailingList[] {
    const lists = this.lists();
    return lists.filter((l) => !l.parent).flatMap((p) => [p, ...lists.filter((l) => l.parent === p.name)]);
  }

  public subLists(): ItOsMailingList[] {
    return this.lists().filter((l) => l.parent);
  }

  /** Who would change if the list were synced from its committee now (the PCC Sync Now preview, Committee → List). */
  public syncDiff(l: ItOsMailingList): ItOsSyncDiff | null {
    const committee = this.committees().find((c) => c.name === l.committee);
    if (!committee) return null;
    const eligible = committee.members.filter((m) => !l.filter?.length || !committee.voting || l.filter.includes(m.status ?? ''));
    const add: ItOsSyncDiff['add'] = [];
    const conflicts: ItOsSyncDiff['conflicts'] = [];
    for (const m of eligible) {
      if (l.members.includes(m.email)) continue;
      const listEmail = (m.alt ?? []).find((e) => l.members.includes(e));
      if (listEmail) conflicts.push({ ...m, listEmail });
      else add.push(m);
    }
    const known = new Set(committee.members.flatMap((m) => [m.email, ...(m.alt ?? [])]));
    const keep = l.keep ?? [];
    const seen = l.seenConflicts ?? [];
    const remove = l.members
      .filter((e) => !known.has(e) && !keep.includes(e))
      .map((email) => {
        const staff = staffOf(email);
        return { email, staffName: staff?.name, staffRole: staff?.role };
      });
    const open = conflicts.filter((m) => !seen.includes(m.email));
    return {
      committee,
      add,
      remove,
      conflicts: open,
      allConflicts: conflicts,
      kept: keep.filter((e) => l.members.includes(e)),
      filtered: committee.members.length - eligible.length,
      inSync: !add.length && !remove.length && !open.length,
    };
  }

  public syncSummary(d: ItOsSyncDiff): string {
    const parts = [
      d.add.length ? `${d.add.length} to add` : '',
      d.remove.length ? `${d.remove.length} to remove` : '',
      d.conflicts.length ? plural(d.conflicts.length, 'email conflict') : '',
    ];
    return parts.filter(Boolean).join(', ') || 'In sync';
  }

  public syncLabel(sync: string | undefined): string {
    return IT_OS_SYNC_LABELS[sync ?? 'manual'];
  }

  // === Engine hooks ===

  protected resetData(): void {
    this.lists.set(structuredClone(IT_OS_SAMPLE_LISTS));
    this.committees.set(structuredClone(IT_OS_SAMPLE_COMMITTEES));
  }

  protected applyScenario(): void {
    this.resetData();
  }

  protected apply(key: string, p: ItOsChangePayload): void {
    const name = String(p['list'] ?? '');
    const lists = this.lists();
    const l = lists.find((x) => x.name === name);
    if (key === 'ml.createList') {
      this.lists.set([
        ...lists,
        {
          name: String(p['name']),
          parent: p['parent'] ? String(p['parent']) : null,
          description: String(p['description'] ?? '—'),
          visibility: String(p['visibility']),
          permission: String(p['permission']),
          subscribers: 0,
          committee: null,
          members: [],
        },
      ]);
      return;
    }
    if (!l) return;
    if (key === 'ml.addMember') {
      const main = lists.find((x) => x.name === l.parent);
      for (const email of Array.isArray(p['emails']) ? p['emails'] : []) {
        if (!l.members.includes(email)) {
          l.members.push(email);
          l.subscribers++;
        }
        if (main && !main.members.includes(email)) {
          main.members.push(email);
          main.subscribers++;
        }
      }
    } else if (key === 'ml.removeMember') {
      l.members = l.members.filter((e) => e !== p['email']);
      l.subscribers--;
    } else if (key === 'ml.setSync') {
      l.sync = String(p['sync']);
    } else if (key === 'ml.linkCommittee') {
      l.committee = String(p['committee']);
      l.sync = String(p['sync'] ?? 'c2l');
    }
    this.lists.set([...lists]);
  }

  protected greet(): void {
    const oos = this.outOfSync();
    const subs = this.subLists();
    const syncLine = oos.length
      ? `<p>${oos.map((l) => `${mono(l.name)} is out of sync with the ${esc(l.committee)} (${this.diffSummary(l)})`).join('. ')}.</p>`
      : '<p>Every list linked to a committee is in sync.</p>';
    this.bot(
      `<p>${esc(IT_OS_SAMPLE_PROJECT.name)} has ${plural(this.lists().length, 'list')} on groups.io at ${mono(IT_OS_LISTS_HOST)}: ${mono('main')} and ${plural(subs.length, 'sub-list')} under it (${subs.map((l) => mono(l.name)).join(', ')}).</p>${syncLine}<p>What do you need?</p>`,
      oos.length ? { actions: [action(`Show me ${oos[0].name}`, () => this.sync(oos[0]), true)] } : {}
    );
  }

  protected route(text: string): void {
    const t = text.toLowerCase();
    const create = text.match(RE_SUBLIST);
    if (create && !/@/.test(create[2])) return this.createSubList(create[2].toLowerCase(), text);
    if (/(create|new|make|add)\s+(a\s+)?sub-?\s?list/.test(t)) {
      this.bot(`<p>What should the sub-list be called? It becomes ${mono(`name@${IT_OS_LISTS_HOST}`)}.</p>`);
      return;
    }
    const l = this.findList(t);
    const emails = text.match(RE_EMAILS);
    if (/bulk|import|paste|csv|many|lots/.test(t) && /add|subscribe|import/.test(t)) return l ? this.bulkAsk(l) : this.whichList();
    if (emails && /add|subscribe/.test(t)) {
      const target = this.listBy((t.match(/\b(?:to|on)\s+(?:the\s+)?([a-z0-9._-]+)(?:\s+(?:sub-?)?list)?\s*$/) ?? [])[1] ?? '') ?? l;
      return target ? this.bulkCheck(target, text.replace(/^[^:]*:/, '')) : this.whichList();
    }
    if (emails && /remove|unsubscribe/.test(t)) {
      if (!l) return this.whichList();
      this.plan("<p>Here's the change:</p>", [{ key: 'ml.removeMember', payload: { list: l.name, email: emails[0] } }]);
      return;
    }
    const link = t.match(/link\s+(?:the\s+)?([a-z0-9._-]+).*?\bto\s+(?:the\s+)?(.+?)(?:\s+(?:with|using)\b.*)?$/);
    if (link) {
      const list = this.listBy(link[1]);
      const committee = this.findCommittee(link[2].replace(/[\s,]*(?:with|using)?\s*(?:list|committee)\s*(?:→|->|to)\s*(?:list|committee).*$/, ''));
      if (!list || !committee) {
        this.bot(
          `<p>Lists: ${this.lists()
            .map((x) => mono(x.name))
            .join(', ')}. Committees: ${this.committees()
            .map((c) => esc(c.name))
            .join(', ')}.</p>`
        );
        return;
      }
      return this.link(list, committee, this.wantsListToCommittee(t) ? 'l2c' : 'c2l');
    }
    if (/(turn on|enable|automatic|auto).*sync|sync.*(automatic|auto)/.test(t) && l) {
      const committee = this.committees().find((c) => c.name === l.committee);
      return committee ? this.link(l, committee, this.wantsListToCommittee(t) ? 'l2c' : 'c2l') : this.sync(l);
    }
    if (/sync|in sync|out of sync|match|why.*(not|isn'?t|wasn'?t).*(on|added|removed)/.test(t)) {
      if (l && l.name !== 'main') return this.sync(l);
      const oos = this.outOfSync();
      if (oos.length) return this.sync(oos[0]);
      const linked = this.lists().filter((x) => x.committee);
      this.bot(
        `<p>Every list linked to a committee is in sync: ${linked.map((x) => `${mono(x.name)} (${esc(x.committee)}, ${this.syncLabel(x.sync)})`).join(', ')}.</p>`
      );
      return;
    }
    const vis = t.match(/make\s+(?:the\s+)?([a-z0-9._-]+)\s+(?:list\s+)?(public|private)/);
    if (vis) {
      const list = this.listBy(vis[1]);
      if (!list) {
        this.bot(`<p>There's no list called ${mono(vis[1])}.</p>`);
        return;
      }
      this.bot(`<p>Changing a list's visibility isn't something I do yet. Contact support for that for now.</p>`);
      return;
    }
    const who = t.match(/(?:who(?:'s| is)? on|members of|subscribers (?:of|on))\s+(?:the\s+)?([a-z0-9._-]+)/);
    if (who) return this.whoIsOn(who[1]);
    if (/cost|price|pay|how much|fee/.test(t)) return this.feeAnswer();
    if (/committee/.test(t)) {
      this.bot(
        `<ul>${this.lists()
          .filter((x) => x.committee)
          .map((x) => `<li>${mono(x.name)} → ${esc(x.committee)} · ${esc(this.syncLabel(x.sync))}</li>`)
          .join('')}</ul>`
      );
      return;
    }
    this.bot('<p>Try "create a sub-list called events", "bulk add subscribers to dev", or "is tsc in sync with its committee?".</p>');
  }

  // === Sub-lists ===

  private createSubList(name: string, text: string): void {
    const t = text.toLowerCase();
    if (this.listBy(name)) {
      this.bot(`<p>${mono(name)} already exists.</p>`);
      return;
    }
    const under = (t.match(/\bunder\s+(?:the\s+)?([a-z0-9._-]+)/) ?? [])[1];
    if (under && under !== 'main') {
      this.bot(`<p>groups.io sub-lists only go one level deep, so every sub-list sits under ${mono('main')}. I can create ${mono(name)} there.</p>`, {
        actions: [action(`Create ${name} under main`, () => this.createSubList(name, `create a sub-list called ${name}`), true)],
      });
      return;
    }
    let permission = 'Moderated Discussion';
    if (/announce/.test(t)) permission = 'Announcement';
    else if (/\bopen\b/.test(t)) permission = 'Open Discussion';
    const visibility = /private/.test(t) ? 'Private' : 'Public';
    const description = (text.match(/\bfor\s+(?!the\s+list)(.+)$/i) ?? [])[1];
    this.plan(
      `<p>This creates ${mono(`${name}@${IT_OS_LISTS_HOST}`)} as a sub-list of ${mono('main')}. I'll make it ${visibility.toLowerCase()} with <b>${permission}</b>: ${esc(IT_OS_LIST_PERMISSION_TEXT[permission])}. Say if you want something different.</p>`,
      [{ key: 'ml.createList', payload: { name, parent: 'main', description, visibility, permission } }]
    );
  }

  // === Bulk add ===

  /** Paste addresses one per line, comma separated, "Name <email>" or rows from a spreadsheet. */
  private bulkAsk(l: ItOsMailingList): void {
    const form: ItOsChatForm = {
      fields: [{ id: 'addresses', kind: 'textarea', label: `Addresses for ${l.name}`, placeholder: 'name@example.org', sample: IT_OS_BULK_SAMPLE }],
      values: {},
    };
    this.bot(
      `<p>Paste the addresses for ${mono(l.name)}: one per line, comma separated, "Name &lt;email&gt;" or rows from a spreadsheet. I'll check them before anything changes.</p>`,
      { form, actions: [action('Check these', () => this.bulkCheck(l, String(form.values['addresses'] ?? '')), true)] }
    );
  }

  private bulkCheck(l: ItOsMailingList, raw: string): void {
    const parts = raw
      .split(/[\n,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const add: string[] = [];
    const already: string[] = [];
    const repeated: string[] = [];
    const invalid: string[] = [];
    for (const part of parts) {
      const found = (part.match(/[^\s<>"@,]+@[^\s<>"@,]+/) ?? [])[0];
      // A bare name from a spreadsheet row is fine to skip.
      if (!found) {
        if (/@/.test(part)) invalid.push(part);
        continue;
      }
      const email = found.toLowerCase();
      if (!RE_EMAIL.test(email) || !/\.[a-z]{2,}$/.test(email)) invalid.push(found);
      else if (seen.has(email)) repeated.push(email);
      else {
        seen.add(email);
        (l.members.includes(email) ? already : add).push(email);
      }
    }
    if (!add.length && !already.length && !invalid.length) {
      this.bot("<p>I didn't find any email addresses in that. Paste one per line.</p>", { actions: [action('Try again', () => this.bulkAsk(l), true)] });
      return;
    }
    const main = this.listBy(l.parent ?? '');
    const notOnMain = main ? add.filter((e) => !main.members.includes(e)) : [];
    const rows = [
      ['Ready to add', add.length],
      ['Already subscribed', already.length],
      ['Repeated in the paste', repeated.length],
      ['Not valid', invalid.length],
    ].filter((r) => r[1]);
    const notes: ItOsChatNote[] = [];
    if (invalid.length) notes.push({ tone: 'warn', text: `Skipped, not valid: ${invalid.join(', ')}` });
    if (notOnMain.length) {
      notes.push({
        tone: 'info',
        text: `${notOnMain.length === 1 ? "1 person isn't" : `${notOnMain.length} people aren't`} on main yet. Sub-list members are also members of main on groups.io, so they'll get main's announcements too.`,
      });
    }
    if (l.committee && l.sync === 'l2c') {
      notes.push({
        tone: 'info',
        text: `${l.name} syncs List → Committee, so new subscribers are added to the ${l.committee}. Anyone LFX doesn't know yet is skipped and has to be added to the committee by hand.`,
      });
    } else if (l.committee) {
      notes.push({
        tone: 'warn',
        text: `${l.name} is linked to the ${l.committee}. People who aren't on the committee will show up for removal the next time it's synced from the committee.`,
      });
    }
    const summary = htmlTable(
      ['', ''],
      rows.map((r) => [esc(r[0]), String(r[1])])
    );
    if (!add.length) {
      this.bot(`<p>Nothing new to add to ${mono(l.name)}.</p>${summary}${notesHtml(notes)}`);
      return;
    }
    const checked = parts.filter((x) => /@/.test(x)).length;
    this.plan(`<p>I checked ${plural(checked, 'address', 'addresses')} for ${mono(l.name)}:</p>${summary}${notesHtml(notes)}`, [
      { key: 'ml.addMember', payload: { list: l.name, emails: add } },
    ]);
  }

  // === Committee sync ===

  private sync(l: ItOsMailingList): void {
    if (!l.committee) {
      const guess = this.committees().find(
        (c) => c.name.toLowerCase().includes(l.name.replace(/-/g, ' ')) || c.members.some((m) => l.members.includes(m.email))
      );
      this.bot(
        `<p>${mono(l.name)} isn't linked to a committee, so there's nothing to sync it with.${guess ? ` Its subscribers overlap with the ${esc(guess.name)}.` : ''}</p>`,
        guess ? { actions: [action(`Link it to the ${guess.name}`, () => this.link(l, guess, 'c2l'), true)] } : {}
      );
      return;
    }
    const d = this.syncDiff(l);
    if (!d) return;
    const dir = this.syncLabel(l.sync);
    const filter =
      l.filter?.length && d.committee.voting
        ? notesHtml([
            {
              tone: 'info',
              text: `Filtered to ${l.filter.join(', ')} members only, set in the list's settings.${d.filtered ? ` ${plural(d.filtered, 'committee member')} ${d.filtered === 1 ? 'is' : 'are'} left out by the filter.` : ''}`,
            },
          ])
        : '';
    if (d.inSync) {
      const kept: ItOsChatNote[] = [
        ...(d.kept.length ? [{ tone: 'info', text: `Kept on the list on purpose, though not on the committee: ${d.kept.join(', ')}.` }] : []),
        ...d.allConflicts.map((m) => ({ tone: 'info', text: `${m.name} is still subscribed as ${m.listEmail} but on the committee as ${m.email}.` })),
      ];
      this.bot(`<p>${mono(l.name)} is in sync with the ${esc(l.committee)}. Sync is set to <b>${esc(dir)}</b>.</p>${filter}${notesHtml(kept)}`);
      return;
    }
    let why = "Sync is <b>Committee → List</b>, but turning on automatic sync doesn't change people who were already members.";
    if (l.sync === 'manual' || !l.sync) why = "Sync is set to <b>Manual</b>, so committee changes don't reach the list on their own.";
    else if (l.sync === 'l2c') why = "Sync is set to <b>List → Committee</b>, so committee changes don't reach the list on their own.";
    const notes: ItOsChatNote[] = [
      ...d.remove
        .filter((r) => r.staffName)
        .map((r) => ({
          tone: 'warn',
          text: `${r.email} is ${r.staffName}, the project's ${r.staffRole} in LFX, but isn't on the committee. I've left that removal unticked.`,
        })),
      ...d.conflicts.map((m) => ({
        tone: 'warn',
        text: `Email conflict: ${m.name} is on the committee as ${m.email} but subscribed as ${m.listEmail}. I won't add them twice. Fix the address in one place if it's wrong.`,
      })),
      ...(l.visibility === 'Public' && d.remove.length
        ? [{ tone: 'info', text: "On a public list, removals from the committee don't carry over automatically, even with Committee → List sync." }]
        : []),
    ];
    // Remember what the user chose to leave alone, so the list counts as in sync afterwards.
    const remember = (kept: string[]): void => {
      l.keep = [...(l.keep ?? []), ...kept];
      l.seenConflicts = [...(l.seenConflicts ?? []), ...d.conflicts.map((m) => m.email)];
      this.lists.update((list) => [...list]);
    };
    const changes = [
      ...d.add.map((m) => ({ key: 'ml.addMember', payload: { list: l.name, emails: [m.email], who: `${m.name} (${m.email})` } })),
      ...d.remove.map((r) => ({ key: 'ml.removeMember', on: !r.staffName, payload: { list: l.name, email: r.email } })),
    ];
    if (!changes.length) {
      remember([]);
      this.bot(`<p>${mono(l.name)} vs the ${esc(l.committee)}: ${this.syncSummary(d)}. Nothing to add or remove.</p>${notesHtml(notes)}`);
      return;
    }
    this.plan(
      `<p>${mono(l.name)} vs the ${esc(l.committee)}: ${this.syncSummary(d)}. ${why}</p>${filter}${notesHtml(notes)}<p>Here's what a sync from the committee would change. Untick anything you want to leave as it is:</p>`,
      changes,
      (skipped) => {
        remember(skipped.filter((c) => c.key === 'ml.removeMember').map((c) => String(c.payload['email'])));
        if (l.sync === 'c2l') return;
        this.bot(
          `<p>${mono(l.name)} is still set to <b>${esc(dir)}</b>, so it will drift again. Turn on <b>Committee → List</b> so new committee members are added automatically${l.visibility === 'Private' ? ' and removed members are taken off' : ''}?</p>`,
          { actions: [action('Turn it on', () => this.plan('', [{ key: 'ml.setSync', payload: { list: l.name, sync: 'c2l' } }]), true)] }
        );
      }
    );
  }

  /** Checks PCC's sync rules before linking. */
  private link(l: ItOsMailingList, c: ItOsCommittee, sync: string): void {
    const others = this.lists().filter((x) => x !== l && x.committee === c.name && x.sync && x.sync !== 'manual');
    if (sync === 'l2c' && l.visibility !== 'Private') {
      this.bot(
        `<p>List → Committee only works with private lists, and ${mono(l.name)} is public. Use Committee → List instead, or make the list private first.</p>`
      );
      return;
    }
    const l2c = others.find((x) => x.sync === 'l2c');
    if (sync === 'l2c' && l2c) {
      this.bot(`<p>The ${esc(c.name)} already gets members from ${mono(l2c.name)}. Only one list per committee can use List → Committee.</p>`);
      return;
    }
    const clash = others.find((x) => x.sync !== sync);
    if (clash) {
      this.bot(
        `<p>${mono(clash.name)} already syncs ${esc(this.syncLabel(clash.sync))} with the ${esc(c.name)}. A committee can't sync in both directions. Change that rule first, or use Manual and sync on demand.</p>`
      );
      return;
    }
    const effect =
      sync === 'c2l'
        ? `New ${esc(c.name)} members will be added to ${mono(l.name)} automatically${l.visibility === 'Private' ? ', and people removed from the committee will be taken off' : ''}.`
        : `People added to ${mono(l.name)} will be added to the ${esc(c.name)}. Subscribers LFX doesn't know yet are skipped.`;
    this.plan(
      `<p>${effect} Turning sync on doesn't change existing members, so I'll check them right after.</p>`,
      [{ key: 'ml.linkCommittee', payload: { list: l.name, committee: c.name, sync } }],
      () => this.sync(l)
    );
  }

  // === Answers ===

  private whoIsOn(name: string): void {
    const l = this.listBy(name);
    if (!l) {
      this.bot(`<p>There's no list called ${mono(name)}.</p>`);
      return;
    }
    const more = l.subscribers > l.members.length ? `<p>and ${(l.subscribers - l.members.length).toLocaleString()} more.</p>` : '';
    this.bot(
      `<p>${mono(l.name)} has ${plural(l.subscribers, 'subscriber')}${l.committee ? `, linked to the ${esc(l.committee)}` : ''}:</p><ul>${l.members
        .slice(0, 8)
        .map((e) => `<li>${mono(e)}</li>`)
        .join('')}</ul>${more}`
    );
  }

  private feeAnswer(): void {
    if (!this.staff()) {
      this.bot(`<p>${IT_OS_FORMATION_TEXT}</p>`);
      return;
    }
    this.bot(
      `<p>The project's groups.io custom domain service is ${IT_OS_FEES.groupsioCustomDomain}/mo. More lists don't add to that.</p>${muted(esc(IT_OS_COST_NOTE))}`
    );
  }

  private whichList(): void {
    this.bot(
      `<p>Which list? ${this.lists()
        .map((x) => mono(x.name))
        .join(', ')}.</p>`
    );
  }

  // === Data helpers ===

  private outOfSync(): ItOsMailingList[] {
    return this.lists().filter((l) => l.committee && !this.syncDiff(l)?.inSync);
  }

  private diffSummary(l: ItOsMailingList): string {
    const d = this.syncDiff(l);
    return d ? this.syncSummary(d) : '';
  }

  private listBy(name: string): ItOsMailingList | undefined {
    return this.lists().find((l) => l.name === name);
  }

  /** The list a message names, matched as a whole word ("tsc", "tsc@", "the tsc list"). */
  private findList(t: string): ItOsMailingList | undefined {
    return this.lists().find((l) => new RegExp(`(^|[^a-z0-9-])${l.name.replace(/[.-]/g, '\\$&')}(@|[^a-z0-9-]|$)`).test(t));
  }

  private findCommittee(raw: string): ItOsCommittee | undefined {
    const s = raw
      .toLowerCase()
      .replace(/\b(the|committee)\b/g, '')
      .trim();
    return s ? this.committees().find((c) => c.name.toLowerCase().includes(s) || initials(c.name) === s) : undefined;
  }

  private wantsListToCommittee(t: string): boolean {
    return /list\s*(→|->|to)\s*committee|from the list/.test(t);
  }
}
