// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_SLIDES_EXPORT_LOGO_MAX_BYTES,
  MKTG_SLIDES_EXPORT_LOGO_RENDER_MAX_CHILDREN,
  MKTG_SLIDES_EXPORT_LOGO_RENDER_MAX_OUTPUT_BYTES,
  MKTG_SLIDES_EXPORT_LOGO_RENDER_TIMEOUT_MS,
  MKTG_SLIDES_EXPORT_LOGO_SIDE_PX,
} from '@lfx-one/shared/constants';
import { MktgLogoPngOptions, MktgLogoPngResult, MktgLogoRenderReply, MktgLogoRenderRequest } from '@lfx-one/shared/interfaces';
import { execFile, ExecFileException } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every `href=` in the source (`xlink:href` and any other prefix included), found without consuming
 * the value: the scan resumes right after the `=`, so a decoy `href=` written inside another
 * attribute's value cannot swallow the real attribute that follows it.
 */
const HREF_ASSIGNMENT = /href\s*=/gi;
/** What may follow `href=`: a quote, then a fragment in the same SVG or an image embedded as a data URL. */
const SAFE_HREF_VALUE = /^\s*(["'])(?:#|data:image\/(?:png|jpeg|gif|webp);)/i;
/** Where every entity declaration starts. */
const ENTITY_START = /<!ENTITY/gi;
/** One whole entity declaration, read quote by quote so a `>` inside a quoted value does not end it early. */
const ENTITY_DECLARATION = /^<!ENTITY((?:[^>"']|"[^"]*"|'[^']*')*)>/i;
/** An external or parameter entity, or one whose text carries markup or references. */
const UNSAFE_ENTITY = /\b(?:SYSTEM|PUBLIC)\b|[<&%]/i;
/** A text element (`<text>`, `<tspan>`, `<textPath>`, namespace prefix or not): live text needs a font to draw. */
const LIVE_TEXT = /<(?:[\w.-]+:)?(?:text|tspan|textPath)[\s>/]/i;
/** How much of the child's stderr a failure's detail keeps. */
const STDERR_TAIL_CHARS = 500;
/**
 * Set to `1` by a test only: the child then never answers, so the bound can
 * be proven without an input that is slow on purpose. Nothing in production
 * sets it.
 */
const HANG_FOR_TEST_ENV = 'MKTG_LOGO_RENDER_HANG_FOR_TEST';

/**
 * The render child: reads one request from stdin, loads the rasterizer from
 * the path the parent resolved, and writes one JSON line back. Every step
 * that touches the rasterizer's native code runs here — the size probe, the
 * drawing, the ink scan and the PNG encode — so that when that code aborts
 * the process (it does, on some geometry, with no exception to catch), it
 * is this process that dies, and the server answers "not drawn". Plain
 * CommonJS, run with `node -e`, so it needs no build step and no file of
 * its own in the server bundle.
 */
const RENDER_CHILD_SOURCE = `
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    const reply = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (process.env['${HANG_FOR_TEST_ENV}'] === '1') {
      setInterval(() => {}, 1 << 30);
      return;
    }
    try {
      const { Resvg } = require(request.resvgPath);
      const base = { logLevel: 'off', font: { loadSystemFonts: false } };
      const { width, height } = new Resvg(request.svg, base);
      if (!(width > 0 && height > 0)) {
        reply({ reason: 'unreadable', detail: 'size ' + width + 'x' + height });
        return;
      }
      const fitTo = width >= height ? { mode: 'width', value: request.sidePx } : { mode: 'height', value: request.sidePx };
      const rendered = new Resvg(request.svg, { ...base, fitTo }).render();
      if (request.requireInk) {
        const pixels = rendered.pixels;
        let ink = false;
        for (let alpha = 3; alpha < pixels.length && !ink; alpha += 4) {
          ink = pixels[alpha] !== 0;
        }
        if (!ink) {
          reply({ reason: 'blank', detail: rendered.width + 'x' + rendered.height + ' with no painted pixel' });
          return;
        }
      }
      const png = rendered.asPng();
      if (png.length > request.maxBytes) {
        reply({ reason: 'too-big', detail: png.length + ' bytes' });
        return;
      }
      reply({ png: png.toString('base64') });
    } catch (error) {
      reply({ reason: 'unreadable', detail: error instanceof Error ? error.message : String(error) });
    }
  });
`;

/** The absolute path of the rasterizer, resolved once; null when it is not installed. */
let resvgPath: string | null | undefined;

/**
 * Where `require('@resvg/resvg-js')` is on disk, resolved from the server
 * bundle first (`dist/lfx-one/server/` in production, where the module is an
 * external dependency and lives in the image's `node_modules`), else from
 * the working directory (the dev server, where `import.meta.url` is a
 * virtual module). Resolved by the server and handed to the child, so the
 * child loads the same copy wherever the process was started — the pattern
 * the PDF text worker uses for its parser.
 */
function resolveResvg(): string | null {
  if (resvgPath !== undefined) {
    return resvgPath;
  }
  const roots: string[] = [];
  try {
    roots.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    // Not a file URL (a bundler's virtual module): the working directory is all there is.
  }
  roots.push(process.cwd());
  resvgPath = null;
  for (const root of roots) {
    try {
      // `createRequire` takes a file in the directory to resolve from; the file itself need not exist.
      resvgPath = createRequire(join(root, 'resolve.cjs')).resolve('@resvg/resvg-js');
      break;
    } catch {
      continue;
    }
  }
  return resvgPath;
}

/**
 * Whether an SVG may be rasterized on this server. The rasterizer reads an
 * `<image>` / `<feImage>` href that names a local path from the server's own
 * disk, so every `href=` in the text (in a comment or another attribute's
 * value too) must be followed by a same-document fragment or an embedded data
 * URL — a raw value that starts with anything else, an entity or character
 * reference included, is refused. Entity declarations that could build markup
 * or an href the scan does not see are refused too, and so is one that does
 * not close.
 */
export function isRasterizableLogoSvg(svg: string): boolean {
  for (const start of svg.matchAll(ENTITY_START)) {
    const declaration = ENTITY_DECLARATION.exec(svg.slice(start.index));
    if (!declaration || UNSAFE_ENTITY.test(declaration[1])) {
      return false;
    }
  }
  for (const assignment of svg.matchAll(HREF_ASSIGNMENT)) {
    if (!SAFE_HREF_VALUE.test(svg.slice(assignment.index + assignment[0].length))) {
      return false;
    }
  }
  return true;
}

/** The end of a child that did not answer, for the log: how it exited and the tail of its stderr. */
function childFailureDetail(exit: ExecFileException, stderr: string): string {
  let how: string;
  if (exit.killed && exit.signal === 'SIGKILL') {
    how = 'was killed at the time bound';
  } else if (exit.signal) {
    how = `exited by ${exit.signal}`;
  } else {
    how = `exited ${exit.code ?? 'unknown'}`;
  }
  const tail = stderr.trim().slice(-STDERR_TAIL_CHARS);
  return `child ${how}${tail ? `: ${tail}` : ''}`;
}

/**
 * Runs tasks at most `limit` at a time, in the order they arrive: a plain
 * promise queue, so the server-wide count of render children stays bounded
 * without a dependency. A settling task hands its slot straight to the
 * first waiter (the slot never counts as free in between, so a caller that
 * arrives in that moment queues behind the waiter); only with no waiter is
 * the slot freed. The task's own timing starts when it runs, not when it is
 * queued: a queued render waits for a slot in addition to its bound.
 */
export function limitConcurrent(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next) {
      next();
    } else {
      running -= 1;
    }
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= limit) {
      // The waiter inherits the settling task's slot; it is counted already.
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running += 1;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/** The child slots: at most MKTG_SLIDES_EXPORT_LOGO_RENDER_MAX_CHILDREN renders alive at once, server-wide. */
const withRenderSlot = limitConcurrent(MKTG_SLIDES_EXPORT_LOGO_RENDER_MAX_CHILDREN);

/** Whether a value is the shape the child writes: an object with a PNG as a string, or a reason and a detail as strings. */
function isChildReply(value: unknown): value is MktgLogoRenderReply {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if ('png' in value) {
    return typeof value.png === 'string';
  }
  return 'reason' in value && typeof value.reason === 'string' && 'detail' in value && typeof value.detail === 'string';
}

/**
 * The child's one line of stdout as its reply: an object that carries a PNG
 * or a reason. Anything else (no JSON, `null`, a string, an empty object, a
 * PNG that is not a string) is `render-failed`: the server reads nothing it
 * does not recognise.
 */
export function readChildReply(stdout: string): MktgLogoRenderReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = undefined;
  }
  if (isChildReply(parsed)) {
    return parsed;
  }
  return { reason: 'render-failed', detail: `child answered unreadably: ${stdout.trim().slice(0, STDERR_TAIL_CHARS)}` };
}

/**
 * One render in a child of its own: the request on stdin, one JSON line back
 * on stdout, bounded in time and in output. Resolves to the child's reply,
 * or to a `render-failed` reply when the child died, overran the bound or
 * answered unreadably. Never rejects. The bound starts when the child does,
 * once it has a slot.
 */
function renderInChild(request: MktgLogoRenderRequest): Promise<MktgLogoRenderReply> {
  return withRenderSlot(() => startRenderChild(request));
}

/** The child itself; see `renderInChild`. */
function startRenderChild(request: MktgLogoRenderRequest): Promise<MktgLogoRenderReply> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      ['-e', RENDER_CHILD_SOURCE],
      {
        timeout: MKTG_SLIDES_EXPORT_LOGO_RENDER_TIMEOUT_MS,
        maxBuffer: MKTG_SLIDES_EXPORT_LOGO_RENDER_MAX_OUTPUT_BYTES,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ reason: 'render-failed', detail: childFailureDetail(error, stderr) });
          return;
        }
        resolve(readChildReply(stdout));
      }
    );
    // A child that dies before reading its stdin closes the pipe; that error ends in the exit above.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(JSON.stringify(request));
  });
}

/**
 * The kit's SVG logo as a PNG for the Slides API (which takes PNG, JPEG or
 * GIF only): its longest side at MKTG_SLIDES_EXPORT_LOGO_SIDE_PX, on a
 * transparent background. Answers why not when the SVG is refused, sets
 * live text, cannot be read or drawn, draws too big, or when the render
 * itself failed.
 *
 * No font is loaded: the runtime image ships none, so live text would draw
 * as nothing while the export reported the logo placed. A logo that sets
 * text is refused instead (`live-text`) and the deck keeps the template's
 * logo; one with its text converted to outlines draws as it is.
 *
 * Every step that touches the rasterizer runs in a child process of its
 * own (`renderInChild`): the size probe, the drawing, the ink scan and the
 * PNG encode. The rasterizer is native code that aborts the whole process
 * on some geometry (an element with a filter or a nested viewport far off
 * the canvas); no exception reaches a catch, and a worker thread would die
 * with the process. Only a process boundary holds it: the child dies, and
 * this answers `render-failed`. The child is bounded in time
 * (MKTG_SLIDES_EXPORT_LOGO_RENDER_TIMEOUT_MS, then killed) and in what it
 * may write back. What stays on the event loop here is the string checks
 * above, the JSON of the request and the reply, and the base64 decode of
 * the PNG.
 *
 * With `requireInk`, a drawing in which nothing is painted is refused
 * (`blank`) before it is encoded: the alpha of every pixel is read once in
 * the child. The variants ask for it, so a crop of empty space or a logo
 * drawn off its canvas is dropped rather than published as a transparent
 * image; the primary does not, and keeps its failure values as they were.
 * With `sidePx`, the longest side is drawn at that size instead of the
 * logo's (the kit's iconography samples, drawn small for a slide).
 */
export async function rasterizeLogoSvg(svg: string, options: MktgLogoPngOptions = {}): Promise<MktgLogoPngResult> {
  if (!isRasterizableLogoSvg(svg)) {
    return { png: null, reason: 'external-reference', detail: 'an href or entity that is not a fragment or an embedded image' };
  }
  if (LIVE_TEXT.test(svg)) {
    return { png: null, reason: 'live-text', detail: 'a text element, which draws as nothing without its font' };
  }
  const resvg = resolveResvg();
  if (!resvg) {
    return { png: null, reason: 'render-failed', detail: 'the rasterizer is not installed where the server can resolve it' };
  }
  const reply = await renderInChild({
    resvgPath: resvg,
    svg,
    requireInk: options.requireInk === true,
    sidePx: options.sidePx ?? MKTG_SLIDES_EXPORT_LOGO_SIDE_PX,
    maxBytes: MKTG_SLIDES_EXPORT_LOGO_MAX_BYTES,
  });
  if ('png' in reply) {
    return { png: Buffer.from(reply.png, 'base64'), reason: null };
  }
  return { png: null, reason: reply.reason, detail: reply.detail };
}
