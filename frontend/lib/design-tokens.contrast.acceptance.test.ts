import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// SDLCCT-99 acceptance tests, mapped to the Gherkin scenarios in
// docs/design/SDLCCT-99.md (側邊選單分類標題與次要文字色票調整以符合對比度):
//  1. 分類標題 -> "scenario 1: sidebar group label color token"
//  2. 次要文字 -> "scenario 2: secondary text shared token"
//  3. 對比度   -> "scenario 3: contrast ratio against white"
//
// These tests read the single source of truth (frontend/app/globals.css)
// directly rather than rendering components, because jsdom (vitest's test
// environment here) does not run the Tailwind/PostCSS pipeline, so
// getComputedStyle() in a component test cannot see Tailwind-generated
// color values. Reading the :root token block is the only way to pin the
// actual hex values that ship to the browser.

const GLOBALS_CSS_PATH = path.resolve(__dirname, "../app/globals.css");
const globalsCss = readFileSync(GLOBALS_CSS_PATH, "utf-8");

function readRootTokenValue(tokenName: string): string {
  // Matches the declaration inside the :root { ... } block specifically
  // (not the @theme inline block, which aliases token names to other CSS
  // variable names rather than literal hex values).
  const rootBlockMatch = globalsCss.match(/:root\s*\{([^}]*)\}/);
  if (!rootBlockMatch) {
    throw new Error("Could not find :root block in globals.css");
  }
  const rootBlock = rootBlockMatch[1];
  const re = new RegExp(`--${tokenName}:\\s*(#[0-9a-fA-F]{6});`);
  const match = rootBlock.match(re);
  if (!match) {
    throw new Error(`Token --${tokenName} not found (as a literal hex value) in :root block`);
  }
  return match[1];
}

// WCAG 2.x relative luminance / contrast ratio formulas, same ones the
// design doc (docs/design-system.md 第1節) uses to justify its token
// table by hand.
function relativeLuminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const [rl, gl, bl] = [r, g, b].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE = "#ffffff";
const WCAG_AA_MIN_CONTRAST = 4.5;

describe("scenario 1: sidebar group label color token", () => {
  it("defines --color-text-tertiary as #667085", () => {
    expect(readRootTokenValue("color-text-tertiary").toLowerCase()).toBe("#667085");
  });
});

describe("scenario 2: secondary text shared token", () => {
  it("defines --color-text-secondary as #475467", () => {
    expect(readRootTokenValue("color-text-secondary").toLowerCase()).toBe("#475467");
  });

  it("is the only hex-literal declaration of this token (single source of truth)", () => {
    // Guard against a future regression where a component hardcodes the
    // hex value instead of using the shared `text-text-secondary` /
    // `text-muted-foreground` utility classes backed by this token.
    const occurrences = globalsCss.match(/#475467/gi) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("scenario 3: contrast ratio against white", () => {
  it("--color-text-tertiary (#667085) vs white is >= 4.5:1", () => {
    const ratio = contrastRatio(readRootTokenValue("color-text-tertiary"), WHITE);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_MIN_CONTRAST);
  });

  it("--color-text-secondary (#475467) vs white is >= 4.5:1", () => {
    const ratio = contrastRatio(readRootTokenValue("color-text-secondary"), WHITE);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_MIN_CONTRAST);
  });

  it("documents the approximate ratios recorded in docs/design-system.md", () => {
    // Not a strict spec requirement by itself, but pins the numbers the
    // design doc cites so a silent drift in the formula/token is caught.
    expect(contrastRatio(readRootTokenValue("color-text-tertiary"), WHITE)).toBeCloseTo(4.97, 1);
    expect(contrastRatio(readRootTokenValue("color-text-secondary"), WHITE)).toBeCloseTo(7.68, 1);
  });
});
