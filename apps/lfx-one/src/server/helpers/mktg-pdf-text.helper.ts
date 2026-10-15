// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inflateSync } from 'node:zlib';

// Module-private parser types (the `event-hero-sponsors.helper.ts` precedent): nothing outside this reader sees them.

/** A PDF name object (`/Type`), without its slash. */
interface PdfName {
  kind: 'name';
  name: string;
}

/** An indirect reference (`12 0 R`); the generation is not needed to resolve it. */
interface PdfRef {
  kind: 'ref';
  num: number;
}

/** A dictionary, with the raw bytes of its stream when it has one. */
interface PdfDict {
  kind: 'dict';
  entries: Record<string, PdfValue>;
  stream?: string;
}

/** A content-stream operator (`Tj`, `BT`, …) or any other bare keyword. */
interface PdfOp {
  kind: 'op';
  op: string;
}

/** A delimiter token (`[`, `]`, `<<`, `>>`, `{`, `}`). */
interface PdfDelim {
  kind: 'delim';
  value: string;
}

type PdfValue = number | boolean | null | string | PdfName | PdfRef | PdfDict | PdfValue[];
type PdfToken = PdfValue | PdfOp | PdfDelim;

/** How one font turns the bytes of a shown string into text. */
interface PdfFontDecoder {
  /** Byte lengths of the font's codes, longest first (simple fonts: one byte). */
  codeLengths: number[];
  /** Code (as a latin1 byte string) → text. */
  map: Map<string, string> | null;
  /** Fallback for a one-byte code with no map entry, or null when unknown codes are dropped. */
  single: ((code: number) => string) | null;
}

/** Thrown when a PDF needs more work than any real document does; `PdfTextReader.read` reports it as `too-complex`. */
class PdfTooComplexError extends Error {}

/**
 * The work one PDF may cost: one unit per byte the lexer moves over, per byte
 * a filter reads or writes, per code decoded and per CMap entry expanded,
 * with a wall-clock limit as the backstop. The reader runs on the BFF's event
 * loop, so a hostile file must stop here — within a fifth of a second — rather
 * than hold every other request for seconds.
 */
class PdfWorkBudget {
  private spent = 0;
  private nextClockCheck = 0;
  private readonly deadline: number;

  public constructor(
    private readonly maxUnits: number,
    maxMillis: number
  ) {
    this.deadline = Date.now() + maxMillis;
  }

  public spend(units: number): void {
    this.spent += units;
    if (this.spent > this.maxUnits) {
      throw new PdfTooComplexError('PDF work budget exhausted');
    }
    if (this.spent >= this.nextClockCheck) {
      this.nextClockCheck = this.spent + 65_536;
      if (Date.now() > this.deadline) {
        throw new PdfTooComplexError('PDF read deadline passed');
      }
    }
  }
}

/**
 * Extracts the readable text of a PDF without a third-party parser, for the
 * Messaging Document's existing documents (the agent cannot read files; LFX
 * One turns them into text first).
 *
 * Scope is deliberately the PDFs people actually export — Google Docs, Word,
 * LibreOffice, browsers: objects found by scanning (incremental updates take
 * the last definition), object streams, FlateDecode, the page tree with
 * inherited resources, Form XObjects, ToUnicode CMaps (bfchar and bfrange) and
 * the standard simple-font encodings with /Differences. Text order is the
 * content-stream order with a line break whenever the baseline moves.
 *
 * It never guesses: an encrypted PDF, a scanned one (images only) or a font
 * with no way back to Unicode yields no text rather than wrong text, and the
 * caller reports the document as not read.
 */
export class PdfTextReader {
  /** Most bytes the streams of one PDF may inflate to, together — a guard against compression bombs. */
  private static readonly maxStreamBytes = 16 * 1024 * 1024;

  /** Deepest Form XObject nesting followed. */
  private static readonly maxFormDepth = 4;

  /** Deepest page-tree nesting followed (real trees are a few levels deep). */
  private static readonly maxPageTreeDepth = 64;

  /**
   * Work units one PDF may cost (see `PdfWorkBudget`): about 200 ms of work,
   * just over the 16 MB inflate cap, so a long real export fits and a crafted
   * one that re-reads the same bytes stops.
   */
  private static readonly maxWorkUnits = 20_000_000;

  /** Wall-clock limit for one PDF, the backstop to the unit budget; a caller may only lower it. */
  public static readonly maxMillis = 200;

  /** Most ToUnicode entries expanded across every font of one PDF; a subset font needs a few hundred. */
  private static readonly maxCMapEntries = 131_072;

  /** WinAnsiEncoding's 0x80–0x9F block (the rest is Latin-1). */
  // prettier-ignore
  private static readonly winAnsiHigh: Record<number, string> = {
    0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
    0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
  };

  /** Glyph names /Differences commonly uses, beyond single letters and `uniXXXX`. */
  // prettier-ignore
  private static readonly glyphNames: Record<string, string> = {
    space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(',
    parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3',
    four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>',
    question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', braceleft: '{', bar: '|', braceright: '}',
    quoteleft: '‘', quoteright: '’', quotedblleft: '“', quotedblright: '”', endash: '–', emdash: '—', bullet: '•', ellipsis: '…', fi: 'fi',
    fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', copyright: '©', registered: '®', trademark: '™', degree: '°', nbspace: ' ', minus: '−',
  };

  private readonly src: string;
  private readonly budget: PdfWorkBudget;
  private readonly objects = new Map<number, PdfValue>();
  private readonly fonts = new Map<PdfDict, PdfFontDecoder>();
  /** Where the last `endstream` keyword starts, so a stream with no end is known without scanning to EOF again. */
  private readonly lastEndstream: number;
  private inflatedBytes = 0;
  private cmapEntries = 0;

  private constructor(bytes: Buffer, maxMillis: number) {
    this.budget = new PdfWorkBudget(PdfTextReader.maxWorkUnits, Math.min(maxMillis, PdfTextReader.maxMillis));
    this.src = bytes.toString('latin1');
    this.lastEndstream = this.src.lastIndexOf('endstream');
  }

  /**
   * The text of a PDF, or a reason it has none: `encrypted` (password or
   * permissions encryption — the strings are ciphertext), `no-text` (a scan,
   * or fonts with no way back to Unicode) or `too-complex` (it needs more work
   * than the reader's budget allows, which no ordinary export does). Never throws.
   *
   * @param maxMillis - A tighter wall-clock limit, when the caller's own budget has less left than `maxMillis`
   */
  public static read(bytes: Buffer, maxMillis: number = PdfTextReader.maxMillis): { text: string } | { reason: 'encrypted' | 'no-text' | 'too-complex' } {
    try {
      const reader = new PdfTextReader(bytes, maxMillis);
      if (/\/Encrypt\s*[\d<]/.test(reader.src)) {
        return { reason: 'encrypted' };
      }
      reader.scanObjects();
      const text = reader
        .pages()
        .map((page) => reader.pageText(page))
        .join('\n\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return /[\p{L}\p{N}]/u.test(text) ? { text } : { reason: 'no-text' };
    } catch {
      // The budget ran out, or a structure too deep for the stack (RangeError): either way, not a document we can read.
      return { reason: 'too-complex' };
    }
  }

  // === Objects ===

  /**
   * Finds every `N G obj`, including those packed in object streams; a later
   * definition wins. Scanning always resumes after the value just parsed, so
   * no byte is lexed twice (an unterminated string or array would otherwise
   * make every header inside it re-parse to EOF). The lookbehind keeps a long
   * digit run from being retried at every offset.
   */
  private scanObjects(): void {
    const header = /(?<!\d)(\d+)\s+\d+\s+obj\b/g;
    const objectStreams: PdfDict[] = [];
    let match: RegExpExecArray | null;
    while ((match = header.exec(this.src)) !== null) {
      const lexer = new PdfLexer(this.src, header.lastIndex, this.budget);
      const value = lexer.parseValue();
      const end = isDict(value) ? this.attachStream(value, lexer) : lexer.pos;
      header.lastIndex = Math.max(header.lastIndex, end);
      if (isDict(value) && nameOf(value.entries['Type']) === 'ObjStm') {
        objectStreams.push(value);
      }
      this.objects.set(Number(match[1]), value === undefined ? null : value);
    }
    for (const stream of objectStreams) {
      this.unpackObjectStream(stream);
    }
  }

  /** Attaches the raw stream bytes that follow a dictionary; returns where scanning may resume. */
  private attachStream(dict: PdfDict, lexer: PdfLexer): number {
    const at = /^\s*stream\r?\n/.exec(this.src.slice(lexer.pos, lexer.pos + 32));
    if (!at) {
      return lexer.pos;
    }
    const start = lexer.pos + at[0].length;
    const length = dict.entries['Length'];
    let end = typeof length === 'number' && /^\s*endstream/.test(this.src.slice(start + length, start + length + 32)) ? start + length : -1;
    if (end < 0 && start <= this.lastEndstream) {
      end = this.src.indexOf('endstream', start);
    }
    if (end < 0) {
      return lexer.pos;
    }
    dict.stream = this.src.slice(start, end);
    return end;
  }

  private unpackObjectStream(stream: PdfDict): void {
    const data = this.decodeStream(stream);
    const count = stream.entries['N'];
    const first = stream.entries['First'];
    if (data === null || typeof count !== 'number' || typeof first !== 'number') {
      return;
    }
    const pairs = new PdfLexer(data, 0, this.budget);
    for (let i = 0; i < count; i++) {
      const num = pairs.parseValue();
      const offset = pairs.parseValue();
      if (typeof num !== 'number' || typeof offset !== 'number') {
        return;
      }
      if (!this.objects.has(num)) {
        const value = new PdfLexer(data, first + offset, this.budget).parseValue();
        this.objects.set(num, value === undefined ? null : value);
      }
    }
  }

  private resolve(value: PdfValue | undefined, depth = 0): PdfValue | undefined {
    if (isRef(value) && depth < 16) {
      return this.resolve(this.objects.get(value.num), depth + 1);
    }
    return value;
  }

  private dictOf(value: PdfValue | undefined): PdfDict | null {
    const resolved = this.resolve(value);
    return isDict(resolved) ? resolved : null;
  }

  /** The stream's bytes after its filters (FlateDecode, ASCII85Decode, ASCIIHexDecode), or null when they cannot be decoded. */
  private decodeStream(dict: PdfDict): string | null {
    if (dict.stream === undefined) {
      return null;
    }
    const filter = this.resolve(dict.entries['Filter']);
    const filters = (Array.isArray(filter) ? filter : [filter]).map((entry) => nameOf(this.resolve(entry))).filter((entry) => entry !== null);
    // A stream drawn many times (a Form XObject) is decoded each time; every pass is paid for.
    this.budget.spend(dict.stream.length);
    let data: Buffer = Buffer.from(dict.stream, 'latin1');
    for (const name of filters) {
      if (name === 'ASCII85Decode' || name === 'A85') {
        data = PdfTextReader.ascii85(data.toString('latin1'));
        continue;
      }
      if (name === 'ASCIIHexDecode' || name === 'AHx') {
        const hex = data
          .toString('latin1')
          .split('>')[0]
          .replace(/[^0-9A-Fa-f]/g, '');
        data = Buffer.from(hex.length % 2 === 1 ? `${hex}0` : hex, 'hex');
        continue;
      }
      if (name !== 'FlateDecode' && name !== 'Fl') {
        return null;
      }
      const budget = PdfTextReader.maxStreamBytes - this.inflatedBytes;
      if (budget <= 0) {
        return null;
      }
      try {
        data = inflateSync(data, { maxOutputLength: budget });
      } catch {
        return null;
      }
      this.inflatedBytes += data.length;
      this.budget.spend(data.length);
    }
    return data.toString('latin1');
  }

  /** ASCII base-85 (`<~ … ~>`; `z` is four zero bytes; a short last group is padded with `u`). */
  private static ascii85(encoded: string): Buffer {
    const body = encoded
      .replace(/^\s*<~/, '')
      .split('~>')[0]
      .replace(/\s+/g, '');
    const out: number[] = [];
    let group: number[] = [];
    const flush = (count: number): void => {
      let value = 0;
      for (let i = 0; i < 5; i++) {
        value = value * 85 + (group[i] ?? 84);
      }
      for (let i = 0; i < count; i++) {
        // Division, not `>>>`: a padded group can exceed 32 bits, and the top bytes must stay exact.
        out.push(Math.floor(value / 2 ** (24 - 8 * i)) % 256);
      }
      group = [];
    };
    for (const char of body) {
      if (char === 'z' && group.length === 0) {
        out.push(0, 0, 0, 0);
        continue;
      }
      group.push(char.charCodeAt(0) - 33);
      if (group.length === 5) {
        flush(4);
      }
    }
    if (group.length > 1) {
      flush(group.length - 1);
    }
    return Buffer.from(out);
  }

  // === Pages ===

  /** Page dictionaries in page-tree order, each with its (inherited) resources. */
  private pages(): { page: PdfDict; resources: PdfDict | null }[] {
    const catalog = [...this.objects.values()].find((value): value is PdfDict => isDict(value) && nameOf(value.entries['Type']) === 'Catalog');
    const root = catalog ? this.dictOf(catalog.entries['Pages']) : null;
    const pages: { page: PdfDict; resources: PdfDict | null }[] = [];
    const seen = new Set<PdfDict>();
    const walk = (node: PdfDict, inherited: PdfDict | null, depth: number): void => {
      if (seen.has(node) || pages.length > 5000 || depth > PdfTextReader.maxPageTreeDepth) {
        return;
      }
      seen.add(node);
      const resources = this.dictOf(node.entries['Resources']) ?? inherited;
      if (nameOf(node.entries['Type']) === 'Page') {
        pages.push({ page: node, resources });
        return;
      }
      const kids = this.resolve(node.entries['Kids']);
      for (const kid of Array.isArray(kids) ? kids : []) {
        const child = this.dictOf(kid);
        if (child) {
          walk(child, resources, depth + 1);
        }
      }
    };
    if (root) {
      walk(root, null, 0);
    }
    if (pages.length === 0) {
      // No usable page tree: every page object, in object-number order.
      for (const num of [...this.objects.keys()].sort((a, b) => a - b)) {
        const value = this.objects.get(num);
        if (isDict(value) && nameOf(value.entries['Type']) === 'Page') {
          pages.push({ page: value, resources: this.dictOf(value.entries['Resources']) });
        }
      }
    }
    return pages;
  }

  private pageText({ page, resources }: { page: PdfDict; resources: PdfDict | null }): string {
    const contents = this.resolve(page.entries['Contents']);
    const parts = (Array.isArray(contents) ? contents : [contents]).map((entry) => this.dictOf(entry));
    const content = parts.map((part) => (part ? (this.decodeStream(part) ?? '') : '')).join('\n');
    return this.interpret(content, resources, 0);
  }

  // === Content streams ===

  /** Runs the text operators of one content stream; a line break whenever the baseline moves. */
  private interpret(content: string, resources: PdfDict | null, depth: number): string {
    const lexer = new PdfLexer(content, 0, this.budget);
    const out: string[] = [];
    let operands: PdfValue[] = [];
    let font: PdfFontDecoder | null = null;
    let lastY: number | null = null;
    const newline = (): void => {
      if (out.length > 0 && out[out.length - 1] !== '\n') {
        out.push('\n');
      }
    };
    const moveTo = (y: number): void => {
      if (lastY !== null && Math.abs(y - lastY) > 0.5) {
        newline();
      }
      lastY = y;
    };
    const show = (bytes: PdfValue): void => {
      if (typeof bytes === 'string' && font) {
        out.push(this.decodeText(bytes, font));
      }
    };

    for (let token = lexer.next(); token !== undefined; token = lexer.next()) {
      if (isDelim(token)) {
        operands.push(lexer.finishCompound(token.value));
        continue;
      }
      if (!isOp(token)) {
        operands.push(token);
        continue;
      }
      const num = (index: number): number => (typeof operands[index] === 'number' ? (operands[index] as number) : 0);
      switch (token.op) {
        case 'Tf':
          font = this.fontDecoder(resources, nameOf(operands[0]));
          break;
        case 'Td':
        case 'TD':
          if (num(1) !== 0) {
            newline();
          }
          break;
        case 'Tm':
          moveTo(num(5));
          break;
        case 'T*':
          newline();
          break;
        case 'Tj':
          show(operands[0]);
          break;
        case "'":
          newline();
          show(operands[0]);
          break;
        case '"':
          newline();
          show(operands[2]);
          break;
        case 'TJ':
          for (const item of Array.isArray(operands[0]) ? operands[0] : []) {
            if (typeof item === 'number' && item < -200) {
              out.push(' ');
            } else {
              show(item);
            }
          }
          break;
        case 'ET':
          out.push(' ');
          break;
        case 'Do':
          out.push(this.formText(resources, nameOf(operands[0]), depth));
          break;
        case 'BI':
          lexer.skipInlineImage();
          break;
        default:
          break;
      }
      operands = [];
    }
    return out.join('');
  }

  /** The text of a Form XObject drawn with `Do`. */
  private formText(resources: PdfDict | null, name: string | null, depth: number): string {
    const xobjects = this.dictOf(resources?.entries['XObject']);
    const form = name ? this.dictOf(xobjects?.entries[name]) : null;
    if (!form || nameOf(form.entries['Subtype']) !== 'Form' || depth >= PdfTextReader.maxFormDepth) {
      return '';
    }
    const content = this.decodeStream(form);
    return content === null ? '' : `\n${this.interpret(content, this.dictOf(form.entries['Resources']) ?? resources, depth + 1)}\n`;
  }

  // === Fonts ===

  private decodeText(bytes: string, font: PdfFontDecoder): string {
    this.budget.spend(bytes.length * font.codeLengths.length);
    let text = '';
    for (let i = 0; i < bytes.length; ) {
      let consumed = 0;
      for (const length of font.codeLengths) {
        const code = bytes.slice(i, i + length);
        const mapped = code.length === length ? font.map?.get(code) : undefined;
        if (mapped !== undefined) {
          text += mapped;
          consumed = length;
          break;
        }
      }
      if (consumed === 0) {
        const fallback = font.single?.(bytes.charCodeAt(i));
        text += fallback ?? '';
        consumed = font.single ? 1 : (font.codeLengths[font.codeLengths.length - 1] ?? 1);
      }
      i += consumed;
    }
    return text;
  }

  private fontDecoder(resources: PdfDict | null, name: string | null): PdfFontDecoder | null {
    const fontsDict = this.dictOf(resources?.entries['Font']);
    const ref = name ? fontsDict?.entries[name] : undefined;
    if (ref === undefined) {
      return null;
    }
    const fontDict = this.dictOf(ref);
    if (!fontDict) {
      return null;
    }
    // Keyed by the font object, not the reference to it: every page's resources name the same font, and its CMap is parsed once.
    const cached = this.fonts.get(fontDict);
    if (cached) {
      return cached;
    }
    const toUnicode = this.dictOf(fontDict.entries['ToUnicode']);
    const cmap = toUnicode ? this.decodeStream(toUnicode) : null;
    const isType0 = nameOf(fontDict.entries['Subtype']) === 'Type0';
    const simple = isType0 ? null : this.simpleEncoding(fontDict);
    const decoder: PdfFontDecoder = cmap ? { ...this.parseCMap(cmap), single: simple } : { codeLengths: isType0 ? [2] : [1], map: null, single: simple };
    this.fonts.set(fontDict, decoder);
    return decoder;
  }

  /** One-byte decoding of a simple font: its base encoding (WinAnsi, MacRoman and Standard all read as WinAnsi here) plus /Differences. */
  private simpleEncoding(fontDict: PdfDict): (code: number) => string {
    const encoding = this.resolve(fontDict.entries['Encoding']);
    const differences = new Map<number, string>();
    const diffs = isDict(encoding) ? this.resolve(encoding.entries['Differences']) : undefined;
    let code = 0;
    for (const entry of Array.isArray(diffs) ? diffs : []) {
      if (typeof entry === 'number') {
        code = entry;
      } else {
        const glyph = PdfTextReader.glyphText(nameOf(entry));
        if (glyph !== null) {
          differences.set(code, glyph);
        }
        code++;
      }
    }
    return (byte: number): string => differences.get(byte) ?? PdfTextReader.winAnsiHigh[byte] ?? (byte >= 0x20 ? String.fromCharCode(byte) : '');
  }

  private static glyphText(name: string | null): string | null {
    if (name === null) {
      return null;
    }
    if (/^[A-Za-z]$/.test(name)) {
      return name;
    }
    const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name);
    if (uni) {
      return String.fromCharCode(parseInt(uni[1], 16));
    }
    return PdfTextReader.glyphNames[name] ?? null;
  }

  /**
   * A ToUnicode CMap: its code lengths (codespace ranges) and its bfchar /
   * bfrange mappings. A bfrange can name 65,536 codes in 20 bytes, so every
   * code expanded counts against one cap for the whole PDF (`maxCMapEntries`):
   * past it, ranges stop expanding and the codes they would have mapped read
   * as unknown.
   */
  private parseCMap(cmap: string): { codeLengths: number[]; map: Map<string, string> } {
    const map = new Map<string, string>();
    const lengths = new Set<number>();
    const hex = (value: string): string => (value.length % 2 === 1 ? `${value}0` : value);
    const bytesOf = (value: string): string => Buffer.from(hex(value), 'hex').toString('latin1');
    const unicode = (value: string): string => PdfTextReader.utf16be(Buffer.from(hex(value), 'hex'));
    const room = (): number => PdfTextReader.maxCMapEntries - this.cmapEntries;
    for (const block of PdfTextReader.cmapBlocks(cmap, 'codespacerange')) {
      for (const range of block.matchAll(/<([0-9A-Fa-f]+)>\s*<[0-9A-Fa-f]+>/g)) {
        lengths.add(Math.ceil(range[1].length / 2));
      }
    }
    for (const block of PdfTextReader.cmapBlocks(cmap, 'bfchar')) {
      for (const pair of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
        if (room() <= 0) {
          break;
        }
        this.cmapEntries++;
        map.set(bytesOf(pair[1]), PdfTextReader.safeUnicode(unicode, pair[2]));
      }
    }
    for (const block of PdfTextReader.cmapBlocks(cmap, 'bfrange')) {
      // `[^\][]` rather than `[^\]]`: an unclosed `[` then fails at the next `[`, not at the end of the block for every range before it.
      for (const range of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\][]*\])/g)) {
        const width = Math.ceil(range[1].length / 2);
        if (width > 4 || room() <= 0) {
          continue;
        }
        const low = parseInt(range[1], 16);
        const targets = range[3].startsWith('[') ? [...range[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((target) => target[1]) : null;
        const base = targets === null ? Buffer.from(hex(range[3].slice(1, -1)), 'hex') : null;
        if (base !== null && base.length < 2) {
          continue;
        }
        // An array maps only as many codes as it lists; every range stays inside its code width and the PDF's remaining room.
        const listed = targets === null ? 65_536 : targets.length;
        const high = Math.min(parseInt(range[2], 16), 256 ** width - 1, low + listed - 1, low + 65_535, low + room() - 1);
        if (high < low) {
          continue;
        }
        this.budget.spend(high - low + 1);
        this.cmapEntries += high - low + 1;
        // Base target: its leading code units fixed, the last one counting up with the code (odd-length targets are malformed and map to nothing).
        const prefix = base !== null && base.length % 2 === 0 ? PdfTextReader.utf16be(base.subarray(0, base.length - 2)) : null;
        const lastUnit = base !== null ? base.readUInt16BE(base.length - 2) : 0;
        for (let code = low; code <= high; code++) {
          const key = PdfTextReader.codeKey(code, width);
          if (targets !== null) {
            map.set(key, PdfTextReader.safeUnicode(unicode, targets[code - low]));
          } else {
            map.set(key, prefix === null ? '' : prefix + String.fromCharCode((lastUnit + code - low) & 0xffff));
          }
        }
      }
    }
    const codeLengths = (lengths.size > 0 ? [...lengths] : [2]).sort((a, b) => b - a);
    return { codeLengths, map };
  }

  /** The bodies of a CMap's `begin<name>` … `end<name>` blocks, found with `indexOf` so an unclosed block costs one scan, not one per opener. */
  private static cmapBlocks(cmap: string, name: string): string[] {
    const blocks: string[] = [];
    const open = `begin${name}`;
    const close = `end${name}`;
    for (let at = cmap.indexOf(open); at >= 0; at = cmap.indexOf(open, at)) {
      const end = cmap.indexOf(close, at + open.length);
      if (end < 0) {
        break;
      }
      blocks.push(cmap.slice(at + open.length, end));
      at = end + close.length;
    }
    return blocks;
  }

  /** A code as the latin1 byte string a shown string carries (`width` bytes, big-endian). */
  private static codeKey(code: number, width: number): string {
    let key = '';
    for (let shift = width - 1; shift >= 0; shift--) {
      key += String.fromCharCode(Math.floor(code / 256 ** shift) % 256);
    }
    return key;
  }

  private static safeUnicode(unicode: (value: string) => string, value: string): string {
    return value.length >= 4 ? unicode(value) : '';
  }

  /** UTF-16BE bytes as text; an odd byte count is malformed and yields nothing. */
  private static utf16be(bytes: Buffer): string {
    return bytes.length % 2 === 0 ? Buffer.from(bytes).swap16().toString('utf16le') : '';
  }
}

/**
 * Tokenizer and value parser for PDF syntax, over a latin1 string (one char
 * per byte). Every token is paid for in the reader's budget (its bytes plus
 * one), and dictionaries and arrays nest at most `maxNesting` deep — deeper
 * openers are read as empty, so no input can overflow the stack.
 */
class PdfLexer {
  /** Deepest dictionary / array nesting parsed; real files stay in single digits. */
  private static readonly maxNesting = 64;

  private depth = 0;

  public constructor(
    private readonly s: string,
    public pos: number,
    private readonly budget: PdfWorkBudget
  ) {}

  /** The next token, or undefined at the end. Strings are latin1 byte strings. */
  public next(): PdfToken | undefined {
    const from = this.pos;
    const token = this.read();
    this.budget.spend(this.pos - from + 1);
    return token;
  }

  /** One complete value (dictionary, array, reference or scalar), or undefined at the end. */
  public parseValue(): PdfValue | undefined {
    const token = this.next();
    if (token === undefined) {
      return undefined;
    }
    if (isDelim(token)) {
      return this.finishCompound(token.value);
    }
    if (isOp(token)) {
      return null;
    }
    if (typeof token === 'number' && Number.isInteger(token)) {
      const saved = this.pos;
      const generation = this.next();
      const keyword = this.next();
      if (typeof generation === 'number' && isOp(keyword) && keyword.op === 'R') {
        return { kind: 'ref', num: token };
      }
      this.pos = saved;
    }
    return token as PdfValue;
  }

  /** Completes the dictionary or array an opening delimiter started. */
  public finishCompound(open: string): PdfValue {
    if (this.depth >= PdfLexer.maxNesting) {
      return null;
    }
    this.depth++;
    try {
      return this.compound(open);
    } finally {
      this.depth--;
    }
  }

  /** Skips an inline image's binary data (`ID` … `EI`), paying for the bytes skipped. */
  public skipInlineImage(): void {
    const from = this.pos;
    const id = this.s.indexOf('ID', this.pos);
    const end = id < 0 ? -1 : this.s.slice(id + 3).search(/\sEI(\s|$)/);
    this.pos = id < 0 || end < 0 ? this.s.length : id + 3 + end + 3;
    this.budget.spend(this.pos - from);
  }

  private read(): PdfToken | undefined {
    this.skipSpace();
    if (this.pos >= this.s.length) {
      return undefined;
    }
    const c = this.s[this.pos];
    if (c === '(') {
      return this.literalString();
    }
    if (c === '<') {
      if (this.s[this.pos + 1] === '<') {
        this.pos += 2;
        return { kind: 'delim', value: '<<' };
      }
      const end = this.s.indexOf('>', this.pos);
      const hex = this.s.slice(this.pos + 1, end < 0 ? this.s.length : end).replace(/[^0-9A-Fa-f]/g, '');
      this.pos = end < 0 ? this.s.length : end + 1;
      return Buffer.from(hex.length % 2 === 1 ? `${hex}0` : hex, 'hex').toString('latin1');
    }
    if (c === '>' && this.s[this.pos + 1] === '>') {
      this.pos += 2;
      return { kind: 'delim', value: '>>' };
    }
    if (c === '[' || c === ']' || c === '{' || c === '}') {
      this.pos++;
      return { kind: 'delim', value: c };
    }
    if (c === '/') {
      const word = this.word(this.pos + 1);
      return { kind: 'name', name: word.replace(/#([0-9A-Fa-f]{2})/g, (_, code: string) => String.fromCharCode(parseInt(code, 16))) };
    }
    const word = this.word(this.pos) || this.s[this.pos++];
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      return Number(word);
    }
    if (word === 'true' || word === 'false') {
      return word === 'true';
    }
    if (word === 'null') {
      return null;
    }
    return { kind: 'op', op: word };
  }

  private compound(open: string): PdfValue {
    if (open === '<<') {
      const entries: Record<string, PdfValue> = {};
      for (let key = this.parseValue(); key !== undefined; key = this.parseValue()) {
        if (key === '>>' || isClose(key)) {
          break;
        }
        const name = nameOf(key);
        const value = this.parseValue();
        if (name !== null && value !== undefined) {
          entries[name] = value;
        }
        if (value === undefined) {
          break;
        }
      }
      return { kind: 'dict', entries };
    }
    if (open === '[' || open === '{') {
      const items: PdfValue[] = [];
      for (let value = this.parseValue(); value !== undefined && !isClose(value); value = this.parseValue()) {
        items.push(value);
      }
      return items;
    }
    return { kind: 'name', name: `__close${open}` };
  }

  private skipSpace(): void {
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (c === '%') {
        while (this.pos < this.s.length && this.s[this.pos] !== '\n' && this.s[this.pos] !== '\r') this.pos++;
      } else if (' \t\r\n\f\0'.includes(c)) {
        this.pos++;
      } else {
        return;
      }
    }
  }

  private word(from: number): string {
    let end = from;
    while (end < this.s.length && !' \t\r\n\f\0()<>[]{}/%'.includes(this.s[end])) end++;
    const word = this.s.slice(from, end);
    this.pos = end;
    return word;
  }

  private literalString(): string {
    let depth = 0;
    let out = '';
    this.pos++;
    while (this.pos < this.s.length) {
      const c = this.s[this.pos++];
      if (c === '\\') {
        const next = this.s[this.pos++] ?? '';
        const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
        if (simple[next] !== undefined) {
          out += simple[next];
        } else if (/[0-7]/.test(next)) {
          const octal = /^[0-7]{1,3}/.exec(this.s.slice(this.pos - 1, this.pos + 2))?.[0] ?? next;
          this.pos += octal.length - 1;
          out += String.fromCharCode(parseInt(octal, 8) & 0xff);
        } else if (next === '\r' && this.s[this.pos] === '\n') {
          this.pos++;
        } else if (next !== '\n' && next !== '\r') {
          out += next;
        }
      } else if (c === '(') {
        depth++;
        out += c;
      } else if (c === ')') {
        if (depth === 0) {
          break;
        }
        depth--;
        out += c;
      } else {
        out += c;
      }
    }
    return out;
  }
}

function isDict(value: unknown): value is PdfDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as PdfDict).kind === 'dict';
}

function isRef(value: unknown): value is PdfRef {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as PdfRef).kind === 'ref';
}

function isDelim(value: unknown): value is PdfDelim {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { kind?: string }).kind === 'delim';
}

function isOp(value: unknown): value is PdfOp {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as PdfOp).kind === 'op';
}

/** A closing delimiter surfaced by `finishCompound` / `next` inside a compound value. */
function isClose(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as { kind?: string; name?: string; value?: string };
  return (record.kind === 'name' && (record.name ?? '').startsWith('__close')) || (record.kind === 'delim' && [']', '}', '>>'].includes(record.value ?? ''));
}

function nameOf(value: unknown): string | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as PdfName).kind === 'name' ? (value as PdfName).name : null;
}
