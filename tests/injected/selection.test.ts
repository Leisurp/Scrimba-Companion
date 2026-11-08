/**
 * @jest-environment jsdom
 */
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP,
  comparePositions,
  isDoubleTap,
  placeMenu,
  selectionFromAnchor,
  wordRangeAt,
} from '../../src/injected/modules/selection';
import type { ITextModel } from '../../src/injected/monacoTypes';

function model(lines: string[], withWordApi = false): ITextModel {
  const m: Partial<ITextModel> = {
    getLineContent: (n: number) => lines[n - 1] ?? '',
    getLineCount: () => lines.length,
  };
  if (withWordApi) {
    // Stand-in for Monaco's language-aware word: here, letters/digits/_/- (CSS-like).
    m.getWordAtPosition = (p) => {
      const l = lines[p.lineNumber - 1];
      let s = p.column - 1;
      let e = p.column - 1;
      const w = (c: string | undefined) => !!c && /[\w-]/.test(c);
      while (s > 0 && w(l[s - 1])) s--;
      while (e < l.length && w(l[e])) e++;
      return e > s ? { word: l.slice(s, e), startColumn: s + 1, endColumn: e + 1 } : null;
    };
  }
  return m as ITextModel;
}

describe('double-tap detection', () => {
  const first = { x: 100, y: 200, t: 1000 };
  test('two quick taps close together', () => {
    expect(isDoubleTap(first, { x: 108, y: 195, t: 1000 + 200 })).toBe(true);
    expect(isDoubleTap(first, { x: 100, y: 200, t: 1000 + DOUBLE_TAP_MS })).toBe(true);
  });
  test('too slow, too far, or no first tap', () => {
    expect(isDoubleTap(first, { x: 100, y: 200, t: 1000 + DOUBLE_TAP_MS + 1 })).toBe(false);
    expect(isDoubleTap(first, { x: 100 + DOUBLE_TAP_SLOP + 1, y: 200, t: 1100 })).toBe(false);
    expect(isDoubleTap(null, { x: 100, y: 200, t: 1100 })).toBe(false);
    expect(isDoubleTap(first, { x: 100, y: 200, t: 900 })).toBe(false);
  });
});

describe('word under the finger', () => {
  const lines = ['const myLeads = [];', 'a => b === c', '  .main-title { }', '    '];
  const r = (sl: number, sc: number, ec: number) => ({ startLineNumber: sl, startColumn: sc, endLineNumber: sl, endColumn: ec });

  test('identifier, from inside, start or end of the word', () => {
    const m = model(lines);
    expect(wordRangeAt(m, { lineNumber: 1, column: 9 })).toEqual(r(1, 7, 14)); // inside myLeads
    expect(wordRangeAt(m, { lineNumber: 1, column: 7 })).toEqual(r(1, 7, 14)); // before m
    expect(wordRangeAt(m, { lineNumber: 1, column: 14 })).toEqual(r(1, 7, 14)); // after s
  });

  test('operators are selected as a run (`=>`, `===`)', () => {
    const m = model(lines);
    expect(wordRangeAt(m, { lineNumber: 2, column: 3 })).toEqual(r(2, 3, 5)); // =>
    expect(wordRangeAt(m, { lineNumber: 2, column: 9 })).toEqual(r(2, 8, 11)); // ===
  });

  test('whitespace selects nothing', () => {
    const m = model(lines);
    expect(wordRangeAt(m, { lineNumber: 4, column: 3 })).toBeNull();
    expect(wordRangeAt(m, { lineNumber: 9, column: 1 })).toBeNull();
  });

  test("uses Monaco's language word when available (CSS class names with dashes)", () => {
    const m = model(lines, true);
    expect(wordRangeAt(m, { lineNumber: 3, column: 6 })).toEqual(r(3, 4, 14)); // main-title
  });
});

describe('selection helpers', () => {
  test('anchor stays fixed whichever way the handle moves', () => {
    const anchor = { lineNumber: 3, column: 5 };
    expect(selectionFromAnchor(anchor, { lineNumber: 4, column: 2 })).toEqual({ selectionStartLineNumber: 3, selectionStartColumn: 5, positionLineNumber: 4, positionColumn: 2 });
    expect(selectionFromAnchor(anchor, { lineNumber: 1, column: 1 })).toEqual({ selectionStartLineNumber: 3, selectionStartColumn: 5, positionLineNumber: 1, positionColumn: 1 });
  });
  test('position ordering', () => {
    expect(comparePositions({ lineNumber: 1, column: 9 }, { lineNumber: 2, column: 1 })).toBeLessThan(0);
    expect(comparePositions({ lineNumber: 2, column: 3 }, { lineNumber: 2, column: 1 })).toBeGreaterThan(0);
    expect(comparePositions({ lineNumber: 2, column: 3 }, { lineNumber: 2, column: 3 })).toBe(0);
  });
});

describe('menu placement', () => {
  const menu = { w: 260, h: 44 };
  const vp = { w: 411, h: 800 };
  test('centred above the selection', () => {
    expect(placeMenu({ left: 100, right: 200, top: 300, bottom: 317 }, menu, vp)).toEqual({ x: 20, y: 300 - 44 - 10 });
  });
  test('below the handles when there is no room above', () => {
    const p = placeMenu({ left: 100, right: 200, top: 20, bottom: 37 }, menu, vp, 10, 30);
    expect(p.y).toBe(37 + 30 + 10);
  });
  test('kept inside the screen', () => {
    expect(placeMenu({ left: 400, right: 410, top: 300, bottom: 317 }, menu, vp).x).toBe(411 - 260 - 8);
    expect(placeMenu({ left: 0, right: 4, top: 300, bottom: 317 }, menu, vp).x).toBe(8);
  });
});
