// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { FOUNDATION_MESSAGE_FILE_NAME_HEADER, FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE } from '@lfx-one/shared/constants';
import { MktgDocumentExtractResponse, MktgDocumentLinkRequest, MktgIntakeDocumentsConfig } from '@lfx-one/shared/interfaces';
import { from, Observable, switchMap, take } from 'rxjs';

/**
 * Turns an intake's existing documents into text through the BFF before the
 * agent runs (the agents cannot fetch or open files). The browser never
 * parses a file: it sends the raw bytes, and the server reads them.
 */
@Injectable({ providedIn: 'root' })
export class MktgIntakeDocumentsService {
  private readonly http = inject(HttpClient);

  /** Reads an uploaded file to text; the text comes back so the form can submit it with the run. */
  public readFile(config: MktgIntakeDocumentsConfig, file: File): Observable<MktgDocumentExtractResponse> {
    // The name rides URI-encoded in a header, never the URL (which the request logger writes).
    const headers = new HttpHeaders({
      'Content-Type': FOUNDATION_MESSAGE_FILE_UPLOAD_CONTENT_TYPE,
      [FOUNDATION_MESSAGE_FILE_NAME_HEADER]: encodeURIComponent(file.name),
    });
    return from(file.arrayBuffer()).pipe(
      switchMap((bytes) => this.http.post<MktgDocumentExtractResponse>(config.endpoints.file, bytes, { headers })),
      take(1)
    );
  }

  /** Reads a link to text and reports what it held; the server reads it again when the run starts. */
  public readLink(config: MktgIntakeDocumentsConfig, url: string): Observable<MktgDocumentExtractResponse> {
    const body: MktgDocumentLinkRequest = { url };
    return this.http.post<MktgDocumentExtractResponse>(config.endpoints.link, body).pipe(take(1));
  }
}
