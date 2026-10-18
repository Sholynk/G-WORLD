/**
 * The client-side PDF draft extractor's heuristics.
 *
 * The parsing itself is pdf.js in the browser; what these tests pin is the
 * text → draft intelligence ported from the legacy cms/lib/pdf-import.js:
 * title picking, Markdown reconstruction, tag suggestion and category
 * guessing. The module attaches itself to globalThis when there is no window,
 * which is what makes it importable here.
 */
import { beforeAll, describe, expect, it } from 'vitest';

interface PdfExtract {
  pickTitle(lines: string[]): string;
  textToMarkdown(text: string, title: string): string;
  suggestTags(text: string): string[];
  guessCategory(text: string): string;
  normalizeText(raw: string): string;
}

let extract: PdfExtract;

beforeAll(async () => {
  await import('../../apps/web/public/admin/pdf-extract.js');
  extract = (globalThis as Record<string, unknown>).SholynkPdfExtract as PdfExtract;
  expect(extract).toBeTruthy();
});

describe('normalizeText', () => {
  it('collapses whitespace and strips page-footer artefacts', () => {
    const text = extract.normalizeText('Some   text\n\n\n\n-- 1 of 5 --\nMore  text\r');
    expect(text).toBe('Some text\n\nMore text');
  });
});

describe('pickTitle', () => {
  it('prefers a short word-case line near the top', () => {
    const title = extract.pickTitle([
      'Multimodal Models in Production Environments',
      'By Jane Doe',
      'Journal of Applied AI, volume 12',
      'Abstract: this paper explores the deployment of multimodal systems.',
    ]);
    expect(title).toBe('Multimodal Models in Production Environments');
  });

  it('never picks a byline or a URL', () => {
    const title = extract.pickTitle(['https://arxiv.org/abs/1234', 'Written by Ada Lovelace', 'Quantum Error Correction Today']);
    expect(title).toBe('Quantum Error Correction Today');
  });

  it('falls back gracefully on an empty document', () => {
    expect(extract.pickTitle([])).toBe('Untitled draft');
  });
});

describe('textToMarkdown', () => {
  it('promotes the title, headings and bullets', () => {
    const md = extract.textToMarkdown(
      [
        'Stablecoins and Digital Payments',
        'By Someone',
        'Introduction and Background',
        'Stablecoins peg a token to a reference asset.',
        '- Peg types vary',
        '1. First numbered point',
      ].join('\n'),
      'Stablecoins and Digital Payments',
    );
    expect(md).toContain('# Stablecoins and Digital Payments');
    // Headings need 2-10 words (the legacy heuristic): single-word lines stay
    // paragraph text, multi-word title-case lines are promoted.
    expect(md).toContain('## Introduction and Background');
    expect(md).toContain('- Peg types vary');
    expect(md).toContain('- First numbered point');
    expect(md).not.toContain('By Someone');
  });

  it('quotes abstracts and comments out keyword lines', () => {
    const md = extract.textToMarkdown('Title Here\nAbstract: a short summary\nKeywords: ai, web3', 'Title Here');
    expect(md).toContain('> a short summary');
    expect(md).toContain('<!-- Keywords: ai, web3 -->');
  });
});

describe('suggestTags', () => {
  it('ranks frequent non-stopwords and lifts tech bigrams', () => {
    const text = 'blockchain blockchain blockchain the and of machine learning appears with machine learning again';
    const tags = extract.suggestTags(text);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(10);
    expect(tags).toContain('blockchain');
    expect(tags.some((tag) => tag.includes(' '))).toBe(true); // a lifted bigram
  });
});

describe('guessCategory', () => {
  it('maps keyword density onto the site categories', () => {
    expect(extract.guessCategory('bitcoin ethereum blockchain token defi wallet')).toBe('Cryptocurrency');
    expect(extract.guessCategory('machine learning llm gpt neural model openai generative ai')).toBe('AI Trends');
    expect(extract.guessCategory('web3 decentralized dao smart contract solidity dapp')).toBe('Web 3');
    expect(extract.guessCategory('esports gaming playstation xbox nintendo steam')).toBe('Game');
    expect(extract.guessCategory('software engineering developer programming javascript cloud api')).toBe('Technology');
    expect(extract.guessCategory('an ordinary sentence about nothing in particular')).toBe('Technology');
  });
});
