// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MKTG_FAMILY_EXPORT_API_PATH, MKTG_FAMILY_EXPORT_KINDS, MKTG_PRINT_FONT_WEIGHTS } from '@lfx-one/shared/constants';
import {
  MktgFamilyExportAgentKey,
  MktgFamilyExportKind,
  MktgFamilyExportLastResponse,
  MktgFamilyExportMember,
  MktgFamilyExportRecord,
  MktgFamilyExportResultResponse,
  MktgFamilyExportRunUpdate,
  MktgFamilyExportStartResponse,
  MktgFamilyExportTarget,
  MktgFamilyPrintTextSource,
  MktgFamilyPrintView,
  MktgRevisionResponse,
  MktgSlidesExportMode,
} from '@lfx-one/shared/interfaces';
import {
  boilerplatesAssetOfRevision,
  brandKitWebsiteHost,
  buildBoilerplatesPrintView,
  buildBrandKitBookView,
  buildFaqPrintView,
  buildFoundationMessagePrintView,
  faqAssetOfRevision,
  foundationMessageAssetOfRevision,
  mktgFamilyExportAgentKeys,
  mktgFamilyPrintConflicts,
  mktgFamilyPrintDocument,
  mktgFamilyPrintNumberConflicts,
  mktgPrintBrand,
  readBrandKitRevision,
} from '@lfx-one/shared/utils';
import { pollMktgSlidesExport } from '@shared/utils/mktg-slides-export-poll.util';
import { catchError, finalize, forkJoin, map, Observable, shareReplay, startWith, switchMap, take, throwError } from 'rxjs';
import { MktgDocumentStoreService } from './mktg-document-store.service';

/** Family-scoped lookups and runs, independent of the family's document-list loading. */
@Injectable({ providedIn: 'root' })
export class MktgFamilyExportService {
  private readonly http = inject(HttpClient);
  private readonly documents = inject(MktgDocumentStoreService);
  private readonly lookups = new Map<string, Observable<MktgFamilyExportLastResponse>>();
  private readonly runs = new Map<string, Observable<MktgFamilyExportRunUpdate>>();

  public last(target: MktgFamilyExportTarget, refresh = false): Observable<MktgFamilyExportLastResponse> {
    const key = this.key(target);
    const existing = this.lookups.get(key);
    if (existing && !refresh) return existing;
    const params = new HttpParams().set('project', target.project).set('familyId', target.familyId);
    const lookup = this.http.get<MktgFamilyExportLastResponse>(`${MKTG_FAMILY_EXPORT_API_PATH}/last`, { params }).pipe(
      take(1),
      catchError((error: unknown) => {
        console.error('[mktg-family-export] Last export read failed', error);
        return throwError(() => error);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.lookups.set(key, lookup);
    return lookup;
  }

  public running(target: MktgFamilyExportTarget): Observable<MktgFamilyExportRunUpdate> | null {
    return this.runs.get(this.key(target)) ?? null;
  }

  /** A run outlives its page. Returning to the family attaches instead of creating a duplicate. */
  public run(target: MktgFamilyExportTarget, mode: MktgSlidesExportMode): Observable<MktgFamilyExportRunUpdate> {
    const key = this.key(target);
    const existing = this.runs.get(key);
    if (existing) return existing;
    const initial: MktgFamilyExportRunUpdate = { mode, skippedMembers: [], logoNote: null, result: null };
    const run = this.http.post<MktgFamilyExportStartResponse>(`${MKTG_FAMILY_EXPORT_API_PATH}/start`, { ...target, mode }).pipe(
      take(1),
      switchMap((started) => {
        const update: MktgFamilyExportRunUpdate = { ...initial, skippedMembers: started.skippedMembers, logoNote: started.logoNote };
        return this.poll(started).pipe(
          map((result) => ({ ...update, result })),
          startWith(update)
        );
      }),
      startWith(initial),
      finalize(() => {
        this.runs.delete(key);
        this.lookups.delete(key);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.runs.set(key, run);
    return run;
  }

  /** Immutable started refs and owner token are replayed verbatim; a pending HTTP request is bounded too. */
  public poll(started: MktgFamilyExportStartResponse): Observable<MktgFamilyExportResultResponse> {
    const body = {
      project: started.snapshot.project,
      familyId: started.snapshot.familyId,
      sessionId: started.sessionId,
      ownerToken: started.ownerToken,
      snapshot: started.snapshot,
    };
    return pollMktgSlidesExport<MktgFamilyExportRecord>(
      () => this.http.post<MktgFamilyExportResultResponse>(`${MKTG_FAMILY_EXPORT_API_PATH}/result`, body),
      started.sessionId
    );
  }

  /** Read approved refs only. Reject changed pointers instead of printing a different revision. */
  public printView(target: MktgFamilyExportTarget, members: MktgFamilyExportMember[], projectName: string): Observable<MktgFamilyPrintView> {
    const printable = members.filter((member) => Object.hasOwn(MKTG_FAMILY_EXPORT_KINDS, member.agentKey));
    if (!printable.length) return throwError(() => new Error('No approved members have a print layout.'));
    return forkJoin(
      printable.map((member) =>
        this.documents.getRevision(target.project, member.agentKey, member.documentId, member.revisionId).pipe(
          map((response) => {
            if (
              response.project !== target.project ||
              response.type.agentKey !== member.agentKey ||
              response.documentId !== member.documentId ||
              response.revision.id !== member.revisionId ||
              response.revision.contentSha256 !== member.contentSha256 ||
              !response.approval ||
              response.approvedCurrent?.revisionId !== member.revisionId
            )
              throw new Error('The approved current changed. Reload and try again.');
            return response;
          })
        )
      )
    ).pipe(
      map((responses) => {
        // Each member by its kind in the family (never an agent list): the kind names the reader its revision needs.
        const kindOf = (agentKey: string): MktgFamilyExportKind | null =>
          agentKey in MKTG_FAMILY_EXPORT_KINDS ? MKTG_FAMILY_EXPORT_KINDS[agentKey as MktgFamilyExportAgentKey] : null;
        const ofKind = (kind: MktgFamilyExportKind): MktgRevisionResponse | undefined => responses.find((response) => kindOf(response.type.agentKey) === kind);
        const kitResponse = ofKind('kit');
        const kit = kitResponse ? readBrandKitRevision(kitResponse.sidecar) : null;
        if (kitResponse && !kit) throw new Error('The approved brand kit could not be read.');
        const frameworkResponse = ofKind('framework');
        // The framework as its standalone print reads it: the content, the run's report and the day it read its sources
        // (one reader, so its Sources & gaps page prints the same blocks inside the family; null report when the record has none).
        const frameworkAsset = frameworkResponse ? foundationMessageAssetOfRevision(frameworkResponse.markdown, frameworkResponse.sidecar) : null;
        if (frameworkResponse && !frameworkAsset) throw new Error('The approved messaging framework could not be read.');
        const book = kit ? buildBrandKitBookView(kit, kitResponse?.revision.number) : null;
        const framework =
          frameworkResponse && frameworkAsset
            ? buildFoundationMessagePrintView(
                frameworkAsset.content,
                projectName,
                frameworkResponse.revision.number ?? null,
                kit,
                frameworkResponse.approval?.approvedAt ?? null,
                frameworkAsset.report,
                frameworkAsset.dateRead ?? null
              )
            : null;
        const brand = mktgPrintBrand(kit);
        const boilerplatesResponse = ofKind('boilerplates');
        const boilerplates = boilerplatesResponse ? boilerplatesAssetOfRevision(boilerplatesResponse.markdown, boilerplatesResponse.sidecar) : null;
        if (boilerplatesResponse && !boilerplates) throw new Error('The approved boilerplates could not be read.');
        const faqResponse = ofKind('faq');
        const faq = faqResponse ? faqAssetOfRevision(faqResponse.markdown, faqResponse.sidecar) : null;
        if (faqResponse && !faq) throw new Error('The approved FAQ could not be read.');
        // The newest member revision names the PDF, so the same set of members always gives the same name.
        const newestRevisionAt = responses
          .map((response) => response.revision.createdAt)
          .filter((createdAt): createdAt is string => !!createdAt && Number.isFinite(Date.parse(createdAt)))
          .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
        // The book's chapters, in exporter order (the family's asset order, not an agent list), each with what its run left open.
        const openItems: Record<MktgFamilyExportKind, string[]> = {
          framework: frameworkAsset?.report?.gaps ?? [],
          kit: kit?.report.findings?.missing_assets.map((missing) => missing.reason) ?? [],
          boilerplates: boilerplates?.report.gaps ?? [],
          // A question the FAQ left unanswered prints nowhere else (the FAQ pages print answered questions only), so it
          // is an open item too, once, whether or not the run's report repeats it as a gap.
          faq: faq ? [...new Set([...faq.report.gaps, ...faq.checks.unanswered.map((entry) => entry.question)])] : [],
        };
        const documents = mktgFamilyExportAgentKeys(target.familyId)
          .map((agentKey) => ({ agentKey, response: responses.find((response) => response.type.agentKey === agentKey) }))
          .filter((entry) => !!entry.response)
          .map(({ agentKey, response }, index) =>
            mktgFamilyPrintDocument(
              target.familyId,
              agentKey,
              index + 1,
              response?.revision.number ?? null,
              response?.approval ?? null,
              openItems[MKTG_FAMILY_EXPORT_KINDS[agentKey]],
              // The Sources table's Data cell: the day the run read its figures (its record's date_read, else its generation date); none → an empty cell.
              this.dataReadAt(response?.sidecar)
            )
          );
        const boilerplatesView = boilerplates ? buildBoilerplatesPrintView(boilerplates, brand) : null;
        const faqView = faq ? buildFaqPrintView(faq, brand) : null;
        // Where the documents disagree: the framework's key numbers against the FAQ's answers and the boilerplates'
        // text, the kit's line against the framework's tagline, the kit's colour conflicts; nothing the texts do not say.
        // Spelling rows (AWS / Amazon Web Services) and the Silver tier are a recorded follow-up (maintainer, 7 Nov 2026).
        const titleOf = (kind: MktgFamilyExportKind): string => documents.find((document) => MKTG_FAMILY_EXPORT_KINDS[document.agentKey] === kind)?.title ?? '';
        const textSources: MktgFamilyPrintTextSource[] = [
          {
            title: titleOf('faq'),
            texts: faqView?.groups.flatMap((group) => group.questions.filter((entry) => entry.answered).map((entry) => entry.answer)) ?? [],
          },
          { title: titleOf('boilerplates'), texts: boilerplatesView?.lengths.map((row) => row.text) ?? [] },
        ].filter((source) => source.title && source.texts.length);
        return {
          framework,
          kit: book,
          // The kit inside the family prints what the standalone print prints: its approval reaches the kit renderer unchanged.
          kitApproval: kitResponse?.approval ?? null,
          boilerplates: boilerplatesView,
          faq: faqView,
          brand,
          projectName,
          printedAt: new Date().toISOString(),
          newestRevisionAt: newestRevisionAt ?? null,
          fontFamily: book?.fontUrl ? book.type.family : brand.fontFamily,
          weights: book?.weights.map((weight) => weight.weight) ?? MKTG_PRINT_FONT_WEIGHTS,
          documents,
          tagline: frameworkAsset?.content.mf.tagline?.trim() ?? '',
          websiteLabel: brandKitWebsiteHost(kit?.websiteUrl ?? null),
          boilerplatesSources: boilerplates?.report.sources_read.map((source) => source.trim()).filter(Boolean) ?? [],
          conflicts: [
            ...mktgFamilyPrintNumberConflicts(framework?.numbers ?? [], textSources),
            ...mktgFamilyPrintConflicts(
              frameworkAsset?.content.mf.tagline ?? '',
              kit?.chapters.voice.line ?? '',
              kit?.report.color_conflicts ?? [],
              titleOf('kit')
            ),
          ],
        };
      })
    );
  }

  /** The day a run read its figures: the envelope's `inputs_record.date_read` (framework, FAQ, boilerplates), else the kit's `generated_at`; null when the sidecar has neither. */
  private dataReadAt(sidecar: Record<string, unknown> | null | undefined): string | null {
    const inputs = sidecar?.['inputs_record'];
    const dateRead = inputs && typeof inputs === 'object' ? (inputs as Record<string, unknown>)['date_read'] : null;
    if (typeof dateRead === 'string' && dateRead.trim()) return dateRead;
    const generatedAt = sidecar?.['generated_at'];
    return typeof generatedAt === 'string' && generatedAt.trim() ? generatedAt : null;
  }

  private key(target: MktgFamilyExportTarget): string {
    return JSON.stringify([target.project, target.familyId]);
  }
}
