// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
  MKTG_SLIDES_EXPORT_API_PATH,
  MKTG_SLIDES_EXPORT_LOGO_DRAW_SIDE_PX,
  MKTG_SLIDES_EXPORT_LOGO_LOAD_MS,
  MKTG_SLIDES_EXPORT_POLL,
} from '@lfx-one/shared/constants';
import {
  MktgSlidesExportLastResponse,
  MktgSlidesExportResultRequest,
  MktgSlidesExportResultResponse,
  MktgSlidesExportStartRequest,
  MktgSlidesExportStartResponse,
  MktgSlidesExportTarget,
} from '@lfx-one/shared/interfaces';
import { brandKitSvgDataUrl, mktgSlidesExportFailed, mktgSlidesExportLogoSize } from '@lfx-one/shared/utils';
import { isTransientHttpError } from '@shared/utils/http-error.utils';
import { catchError, exhaustMap, map, Observable, of, take, takeLast, takeWhile, throwError, timer } from 'rxjs';

/**
 * Export to Google Slides for the Marketing OS asset pages. The BFF reads
 * the asset from the document store and starts the exporter; this client
 * starts it, polls it until the deck lands, and reads a document's last
 * export. It also draws the kit's SVG logo as a PNG — the Slides API takes
 * PNG, JPEG or GIF only — which the BFF checks and publishes where Google
 * can fetch it.
 */
@Injectable({ providedIn: 'root' })
export class MktgSlidesExportService {
  private readonly document = inject(DOCUMENT);
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  /** The document's last export and its latest revision. */
  public last(target: MktgSlidesExportTarget): Observable<MktgSlidesExportLastResponse> {
    const params = new HttpParams().set('project', target.project).set('agentKey', target.agentKey).set('documentId', target.documentId);
    return this.http.get<MktgSlidesExportLastResponse>(`${MKTG_SLIDES_EXPORT_API_PATH}/last`, { params }).pipe(take(1));
  }

  /** Start an export: the session to poll and the revision it exports. */
  public start(request: MktgSlidesExportStartRequest): Observable<MktgSlidesExportStartResponse> {
    return this.http.post<MktgSlidesExportStartResponse>(`${MKTG_SLIDES_EXPORT_API_PATH}/start`, request).pipe(take(1));
  }

  /**
   * Poll an export until it is ready or failed; one emission. A transient
   * poll failure is a spent attempt, and an export still pending when the
   * attempts run out answers the timeout message (it may still finish).
   */
  public poll(target: MktgSlidesExportTarget, started: MktgSlidesExportStartResponse): Observable<MktgSlidesExportResultResponse> {
    const body: MktgSlidesExportResultRequest = {
      project: target.project,
      agentKey: target.agentKey,
      documentId: target.documentId,
      revisionId: started.revision.id,
      sessionId: started.sessionId,
      ownerToken: started.ownerToken,
    };
    return timer(MKTG_SLIDES_EXPORT_POLL.intervalMs, MKTG_SLIDES_EXPORT_POLL.intervalMs).pipe(
      exhaustMap(() =>
        this.http
          .post<MktgSlidesExportResultResponse>(`${MKTG_SLIDES_EXPORT_API_PATH}/result`, body)
          .pipe(catchError((error) => (isTransientHttpError(error) ? of<MktgSlidesExportResultResponse>({ status: 'pending' }) : throwError(() => error))))
      ),
      take(MKTG_SLIDES_EXPORT_POLL.maxAttempts),
      takeWhile((result) => result.status === 'pending', true),
      takeLast(1),
      map((result) => (result.status === 'pending' ? mktgSlidesExportFailed('timeout') : result))
    );
  }

  /**
   * The kit's SVG logo drawn as a PNG (base64, no data-URL prefix), the
   * longest side at the drawing size; undefined on the server, without an
   * SVG, or when the browser cannot draw it (it never loads, or the canvas
   * refuses to export).
   */
  public async drawLogoPng(svg: string | null): Promise<string | undefined> {
    // SSR guard: Image and canvas are browser-only (ssr-safety rule).
    if (!svg || !isPlatformBrowser(this.platformId)) {
      return undefined;
    }
    try {
      const image = await this.loadImage(brandKitSvgDataUrl(svg));
      const size = mktgSlidesExportLogoSize(svg, { width: image.naturalWidth, height: image.naturalHeight }, MKTG_SLIDES_EXPORT_LOGO_DRAW_SIDE_PX);
      const canvas = this.document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) {
        return undefined;
      }
      context.drawImage(image, 0, 0, size.width, size.height);
      const dataUrl = canvas.toDataURL('image/png');
      return dataUrl.startsWith('data:image/png;base64,') ? dataUrl.slice('data:image/png;base64,'.length) : undefined;
    } catch {
      return undefined;
    }
  }

  /** An image loaded from a data URL, or a rejection when it does not load within a few seconds. */
  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timeout = setTimeout(() => reject(new Error('The logo did not load')), MKTG_SLIDES_EXPORT_LOGO_LOAD_MS);
      image.onload = () => {
        clearTimeout(timeout);
        resolve(image);
      };
      image.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('The logo did not load'));
      };
      image.src = src;
    });
  }
}
