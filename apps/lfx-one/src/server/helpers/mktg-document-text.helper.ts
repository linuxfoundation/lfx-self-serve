// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MktgPdfWorkerReply, MktgReadText } from '@lfx-one/shared/interfaces';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { Worker } from 'node:worker_threads';

/**
 * Turns an uploaded file into the text an agent with no file access reads
 * (the Messaging Document's existing documents): PDF (Mozilla's pdf.js,
 * through unpdf), Word .docx (mammoth), Markdown and plain text, told apart
 * by their bytes. No source or link is read here — the agent fetches its own
 * sources. Nothing here fetches; nothing throws — what cannot be read comes
 * back with its reason.
 */
export class MktgDocumentText {
  /** Wall-clock limit for one PDF; a caller whose own budget has less left may only lower it. */
  public static readonly maxPdfMillis = 200;

  /** Most pages one PDF may have; a longer one is refused as too complex before any page is read. */
  private static readonly maxPdfPages = 300;

  /** Heap one PDF's worker may grow to; past it the worker dies and the file is too complex. */
  private static readonly maxPdfHeapMb = 256;

  /** How long a PDF worker may take to start and load pdf.js, off the PDF's own clock. */
  private static readonly pdfStartMillis = 5_000;

  /**
   * The PDF worker: loads pdf.js (through unpdf), says it is ready, then reads
   * the one PDF it is sent and posts back its text or the reason it has none.
   */
  private static readonly pdfWorkerSource = `
    const { parentPort } = require('node:worker_threads');
    require('unpdf').getResolvedPDFJS().then(({ getDocument }) => {
      parentPort.once('message', async ({ bytes, maxPages }) => {
        try {
          const pdf = await getDocument({ data: bytes, disableFontFace: true, verbosity: 0 }).promise;
          if (pdf.numPages > maxPages) {
            parentPort.postMessage({ reason: 'too-complex' });
            return;
          }
          const pages = [];
          for (let number = 1; number <= pdf.numPages; number++) {
            const content = await (await pdf.getPage(number)).getTextContent();
            pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\\n' : '') : '')).join(''));
          }
          parentPort.postMessage({ text: pages.join('\\n\\n') });
        } catch (error) {
          parentPort.postMessage({ reason: error && error.name === 'PasswordException' ? 'encrypted' : 'too-complex' });
        }
      });
      parentPort.postMessage({ ready: true });
    }, () => parentPort.postMessage({ reason: 'unsupported' }));
  `;

  /** Wall-clock limit for one .docx; a caller whose own budget has less left may only lower it. */
  public static readonly maxDocxMillis = 500;

  /** Most entries a .docx's zip may list; a real one has a few dozen parts. */
  private static readonly maxDocxEntries = 1_000;

  /**
   * Most bytes a .docx's markup (its `.xml` and `.rels` parts, everything
   * mammoth parses for text) may inflate to, all parts together. mammoth's XML
   * parse is synchronous and builds a DOM, so this cap is what bounds the
   * event-loop time and memory one Word file takes: about a quarter of a
   * second at the cap, for a body far longer than the 60,000 characters kept.
   */
  private static readonly maxDocxMarkupBytes = 2 * 1024 * 1024;

  /**
   * The text of an uploaded file. The format is told from the bytes, not the
   * file name: a PDF by its header, a Word file by its zip signature, and
   * anything else without a NUL byte as text (Markdown is kept as written).
   *
   * @param bytes - The raw bytes
   * @param maxMillis - A tighter wall-clock limit than the format's own (`maxPdfMillis`, `maxDocxMillis`)
   */
  public static async read(bytes: Buffer, maxMillis = Number.POSITIVE_INFINITY): Promise<MktgReadText> {
    try {
      return await MktgDocumentText.readBytes(bytes, maxMillis);
    } catch {
      // Each reader maps its own failures; this keeps the never-throws promise for anything they did not foresee.
      return MktgDocumentText.none('unsupported');
    }
  }

  private static async readBytes(bytes: Buffer, maxMillis: number): Promise<MktgReadText> {
    const head = bytes.subarray(0, 1024).toString('latin1');

    // A PDF reader accepts the header anywhere in the first kilobyte (some generators write junk before it).
    if (head.includes('%PDF-')) {
      return MktgDocumentText.pdfText(bytes, Math.min(maxMillis, MktgDocumentText.maxPdfMillis));
    }
    if (head.startsWith('PK\u0003\u0004')) {
      return MktgDocumentText.docxText(bytes, Math.min(maxMillis, MktgDocumentText.maxDocxMillis));
    }
    if (bytes.includes(0)) {
      return MktgDocumentText.none('unsupported');
    }
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    return MktgDocumentText.ok(text.replace(/\r\n?/g, '\n'));
  }

  private static ok(text: string): MktgReadText {
    const trimmed = text.trim();
    return /[\p{L}\p{N}]/u.test(trimmed) ? { text: trimmed, truncated: false } : MktgDocumentText.none('no-text');
  }

  private static none(reason: MktgReadText['reason']): MktgReadText {
    return { text: null, truncated: false, reason };
  }

  // === PDF ===

  /**
   * A PDF's text, page by page, with a line break wherever pdf.js ends a line.
   * pdf.js runs in a worker thread: it inflates and walks a content stream
   * synchronously, so on the BFF's own thread a small, highly compressed PDF
   * would hold the event loop for seconds. The deadline starts once the worker
   * has loaded pdf.js, and when it passes the worker is terminated, mid-stream
   * if need be; its heap is capped too. A PDF past the deadline, over the heap
   * cap, of more than `maxPdfPages` pages, or that pdf.js cannot parse is
   * `too-complex` (its message asks for a fresh export). A password-protected
   * PDF is `encrypted`; a scan is `no-text`.
   */
  private static async pdfText(bytes: Buffer, maxMillis: number): Promise<MktgReadText> {
    const worker = new Worker(MktgDocumentText.pdfWorkerSource, {
      eval: true,
      resourceLimits: { maxOldGenerationSizeMb: MktgDocumentText.maxPdfHeapMb },
    });
    try {
      const ready = await MktgDocumentText.workerReply(worker, MktgDocumentText.pdfStartMillis);
      if (!ready?.ready) {
        return MktgDocumentText.none(ready?.reason ?? 'unsupported');
      }
      worker.postMessage({ bytes: new Uint8Array(bytes), maxPages: MktgDocumentText.maxPdfPages });
      const reply = await MktgDocumentText.workerReply(worker, maxMillis);
      if (typeof reply?.text !== 'string') {
        return MktgDocumentText.none(reply?.reason ?? 'too-complex');
      }
      const text = reply.text
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');
      return MktgDocumentText.ok(text);
    } finally {
      await worker.terminate();
    }
  }

  /** The worker's next message, or null when it fails, exits or stays silent for `millis`. */
  private static workerReply(worker: Worker, millis: number): Promise<MktgPdfWorkerReply | null> {
    return new Promise((resolve) => {
      const settle = (reply: MktgPdfWorkerReply | null): void => {
        clearTimeout(timer);
        worker.off('message', settle).off('error', fail).off('exit', fail);
        resolve(reply);
      };
      const fail = (): void => settle(null);
      // Declared after the handlers it is cleared in: none of them can run before this line.
      const timer = setTimeout(fail, millis);
      worker.on('message', settle).on('error', fail).on('exit', fail);
    });
  }

  // === Word (.docx) ===

  /**
   * A .docx body's text through mammoth, a blank line between paragraphs.
   * mammoth only ever sees a copy holding the file's markup (`docxMarkup`), so
   * what it parses is capped before it starts. The deadline is a race, and is
   * checked again before mammoth starts; mammoth's XML parse itself cannot be
   * interrupted, so a parse already running when the deadline passes finishes
   * in the background, bounded by the markup cap. A zip listing more than
   * `maxDocxEntries` parts, markup over the cap or a passed deadline is
   * `too-complex`; a broken archive, or one that is not a Word document, is
   * `unsupported`.
   */
  private static async docxText(bytes: Buffer, maxMillis: number): Promise<MktgReadText> {
    const deadline = performance.now() + maxMillis;
    let timer: NodeJS.Timeout | undefined;
    const expiry = new Promise<MktgReadText>((resolve) => {
      timer = setTimeout(() => resolve(MktgDocumentText.none('too-complex')), maxMillis);
    });
    const extraction = (async (): Promise<MktgReadText> => {
      const markup = await MktgDocumentText.docxMarkup(bytes, deadline);
      if (markup === null || performance.now() >= deadline) {
        return MktgDocumentText.none('too-complex');
      }
      const { value } = await mammoth.extractRawText({ buffer: markup });
      return MktgDocumentText.ok(value.replace(/\n{3,}/g, '\n\n'));
    })().catch(() => MktgDocumentText.none('unsupported'));
    try {
      return await Promise.race([extraction, expiry]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A copy of a .docx holding only its `.xml` and `.rels` parts, stored
   * uncompressed, or null once they inflate past `maxDocxMarkupBytes` together
   * or the deadline passes. Nothing else is inflated: images and embedded files
   * are never read for text, so a compression bomb among them costs nothing,
   * and a main document hidden under another name is simply not in the copy.
   */
  private static async docxMarkup(bytes: Buffer, deadline: number): Promise<Buffer | null> {
    if (!MktgDocumentText.zipEntriesWithin(bytes, MktgDocumentText.maxDocxEntries)) {
      return null;
    }
    const source = await JSZip.loadAsync(bytes);
    const copy = new JSZip();
    let inflated = 0;
    for (const entry of Object.values(source.files).filter((file) => !file.dir && /\.(xml|rels)$/i.test(file.name))) {
      if (performance.now() >= deadline) {
        return null;
      }
      const chunks: Buffer[] = [];
      const within = await new Promise<boolean>((resolve, reject) => {
        const stream = entry.nodeStream('nodebuffer');
        const onData = (chunk: Buffer): void => {
          inflated += chunk.length;
          if (inflated > MktgDocumentText.maxDocxMarkupBytes || performance.now() >= deadline) {
            stream.pause();
            stream.off('data', onData);
            resolve(false);
          } else {
            chunks.push(chunk);
          }
        };
        stream.on('data', onData);
        // Kept after a stop, so a late inflate error is swallowed rather than thrown as an unhandled 'error' event.
        stream.on('error', reject);
        stream.on('end', () => resolve(true));
      });
      if (!within) {
        return null;
      }
      copy.file(entry.name, Buffer.concat(chunks));
    }
    return copy.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  }

  /**
   * Whether a zip lists at most `max` entries, counted before JSZip reads it:
   * JSZip walks every central-directory header it finds, whatever the
   * archive's own count says, so this counts their signatures in the bytes.
   * Stray signature bytes inside compressed data only raise the count.
   */
  private static zipEntriesWithin(bytes: Buffer, max: number): boolean {
    const signature = Buffer.from('PK\u0001\u0002', 'latin1');
    let count = 0;
    for (let at = bytes.indexOf(signature); at !== -1; at = bytes.indexOf(signature, at + signature.length)) {
      count += 1;
      if (count > max) {
        return false;
      }
    }
    return true;
  }
}
