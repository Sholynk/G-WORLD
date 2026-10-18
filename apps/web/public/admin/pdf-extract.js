/**
 * Sholynk CMS — client-side PDF → article-draft extractor.
 *
 * The legacy CMS parsed uploads on the server with pdf-parse. Workers cannot
 * run that Node-only pipeline, and uploading a manuscript just to echo text
 * back is needless round-tripping — so the extraction now happens entirely in
 * the admin's browser with pdf.js (loaded from jsDelivr on first use). Nothing
 * leaves the machine until the author saves the article itself.
 *
 * The goal is unchanged: NOT a perfect Word reconstruction, but "good first
 * draft" — a likely title, Markdown-ish paragraphs, a teaser, keyword tags and
 * a category guess, in the exact shape the article form expects. The heuristic
 * functions below are a faithful port of cms/lib/pdf-import.js.
 */
// `window` in the browser; `globalThis` so the heuristic functions below are
// also unit-testable from Node (tests/unit/pdf-extract.test.ts).
const SholynkScope = typeof window !== 'undefined' ? window : globalThis;

SholynkScope.SholynkPdfExtract = (() => {
  const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
  let pdfjsPromise = null;

  function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(`${PDFJS_BASE}pdf.min.mjs`)
        .then((pdfjs) => {
          pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
          return pdfjs;
        })
        .catch((error) => {
          pdfjsPromise = null;
          throw new Error(`Could not load the PDF reader (${error.message}). Check your connection and try again.`);
        });
    }
    return pdfjsPromise;
  }

  const STOPWORDS = new Set([
    'a','an','the','and','or','but','if','then','of','at','by','for','with','about',
    'to','in','on','from','as','is','are','was','were','be','been','being','this',
    'that','these','those','it','its','into','onto','than','so','such','not','no',
    'yes','also','just','only','over','under','more','most','less','least','can',
    'will','would','should','could','may','might','must','shall','do','does','did',
    'have','has','had','having','i','you','he','she','we','they','them','their',
    'our','your','his','her','my','me','him','us','what','which','who','whom',
    'when','where','why','how','all','any','some','each','every','other','another',
    'because','while','although','though','after','before','during','between'
  ]);

  const CATEGORY_KEYWORDS = {
    'AI Trends': ['ai','artificial','intelligence','machine','learning','llm','gpt','neural','model','chatgpt','openai','generative'],
    Technology: ['software','engineering','developer','programming','javascript','python','cloud','saas','api','hardware','startup'],
    Cryptocurrency: ['bitcoin','crypto','cryptocurrency','ethereum','blockchain','token','defi','nft','wallet','mining','solana'],
    'Web 3': ['web3','decentralized','dao','smart contract','solidity','dapp','metamask','ipfs'],
    Game: ['game','gaming','esports','playstation','xbox','nintendo','steam','gamer','vr','metaverse']
  };

  function normalizeText(raw) {
    return String(raw || '')
      .replace(/\r/g, '')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      // Strip common page-footer lines PDF generators emit ("-- 1 of 5 --").
      .replace(/^\s*--\s*\d+\s*of\s*\d+\s*--\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  function isBylinish(line) {
    const t = line.trim();
    return /^(?:by|written by|author[: ])/i.test(t)
      || /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.test(t)
      || /^https?:\/\//i.test(t);
  }

  function isHeaderLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (isBylinish(trimmed)) return false;
    if (trimmed.length > 110) return false;
    if (trimmed === trimmed.toUpperCase() && /[A-Z]{3,}/.test(trimmed) && trimmed.length < 80) return true;
    if (/^[A-Za-z0-9][A-Za-z0-9&,:'"+\-()\s]{1,100}$/.test(trimmed)) {
      const words = trimmed.split(/\s+/).filter(Boolean);
      if (words.length >= 2 && words.length <= 10 && !/[.!?]$/.test(trimmed)) return true;
    }
    return false;
  }

  function scoreTitle(candidates) {
    return candidates
      .map((text, index) => {
        const words = text.split(/\s+/).filter(Boolean);
        let score = 0;
        if (words.length >= 3 && words.length <= 18) score += 10;
        if (index < 3) score += 8;
        if (index < 8) score += 4;
        if (isBylinish(text) || /\d{1,2}\/\d{1,2}/.test(text)) score -= 20;
        if (text === text.toUpperCase()) score += 2;
        if (/^[\d\W]+$/.test(text)) score -= 10;
        return { text, score, index };
      })
      .sort((a, b) => b.score - a.score);
  }

  function pickTitle(lines) {
    const head = lines.slice(0, 25).map((l) => l.trim()).filter((l) => l && !isBylinish(l));
    if (!head.length) return 'Untitled draft';
    const ranked = scoreTitle(head);
    return (ranked[0]?.text || head[0]).slice(0, 160);
  }

  function pickDescription(paragraphs, title) {
    const bodyParagraphs = paragraphs.filter((p) => {
      const t = p.trim();
      if (!t) return false;
      if (t === title) return false;
      if (isBylinish(t)) return false;
      if (t.length < 60) return false;
      if (/^(abstract[: ]|keywords[: ])/i.test(t)) return false;
      if (/^--\s*\d+\s*of\s*\d+\s*--$/i.test(t)) return false;
      return true;
    });
    return (bodyParagraphs[0] || '').trim().slice(0, 300);
  }

  function textToMarkdown(text, title) {
    const lines = text.split('\n');
    const out = [];
    let afterTitle = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        continue;
      }
      if (!afterTitle && line === title) {
        afterTitle = true;
        out.push(`# ${line}`);
        out.push('');
        continue;
      }
      if (!afterTitle && isBylinish(line)) continue;
      if (afterTitle && out.length <= 4 && isBylinish(line)) continue;
      if (/^abstract[:\s]/i.test(line)) {
        out.push(`> ${line.replace(/^abstract[:\s]*/i, '')}`);
        out.push('');
        continue;
      }
      if (/^keywords?[:\s]/i.test(line)) {
        out.push(`<!-- Keywords: ${line.replace(/^keywords?[:\s]*/i, '')} -->`);
        out.push('');
        continue;
      }
      if (isHeaderLine(line) && line !== title && line.split(/\s+/).length <= 10) {
        out.push(`## ${line.replace(/[:]+$/, '')}`);
        out.push('');
        continue;
      }
      if (/^[-*•·]\s+/.test(line)) {
        out.push(`- ${line.replace(/^[-*•·]\s+/, '')}`);
        continue;
      }
      if (/^\d+[.)]\s+/.test(line)) {
        out.push(`- ${line.replace(/^\d+[.)]\s+/, '')}`);
        continue;
      }
      out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function suggestTags(text) {
    const words = String(text).toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || [];
    const freq = new Map();
    for (const word of words) {
      if (STOPWORDS.has(word)) continue;
      if (/^\d+$/.test(word)) continue;
      freq.set(word, (freq.get(word) || 0) + 1);
    }
    const tokens = words.filter((w) => !STOPWORDS.has(w));
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      if (/(ai|machine|web|crypto|blockchain|neural|openai|large language|software)/i.test(bigram)) {
        freq.set(bigram, (freq.get(bigram) || 0) + 2);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([term]) => term)
      .filter((t, i, arr) => arr.indexOf(t) === i);
  }

  function guessCategory(text) {
    const lower = text.toLowerCase();
    let best = 'Technology';
    let bestScore = 0;
    for (const [category, kws] of Object.entries(CATEGORY_KEYWORDS)) {
      const score = kws.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = category;
      }
    }
    return best;
  }

  /** Rejoins pdf.js text items into lines using their y coordinates. */
  function itemsToLines(items) {
    const rows = new Map();
    for (const item of items) {
      if (!item || typeof item.str !== 'string') continue;
      const y = Math.round(item.transform?.[5] ?? 0);
      const x = item.transform?.[4] ?? 0;
      const row = rows.get(y) || [];
      row.push({ x, str: item.str });
      rows.set(y, row);
    }
    return [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) => row.sort((a, b) => a.x - b.x).map((part) => part.str).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  async function extractPdfDraft(file) {
    if (!file) throw new Error('No PDF file received');
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) {
      throw new Error('Only PDF files are accepted for import.');
    }
    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();
    const document_ = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber += 1) {
      const page = await document_.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(itemsToLines(content.items).join('\n'));
    }

    let info = {};
    try {
      const metadata = await document_.getMetadata?.();
      info = metadata?.info || {};
    } catch {
      // Metadata is optional; ignore failures.
    }

    const text = normalizeText(pageTexts.join('\n\n'));
    if (!text.trim()) throw new Error('That PDF has no extractable text (it may be a scan).');

    const lines = text.split('\n').map((l) => l.trim());
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim());
    const title = pickTitle(lines);
    const description = pickDescription(paragraphs, title);
    const body = textToMarkdown(text, title);
    const tags = suggestTags(text).slice(0, 6);
    const category = guessCategory(text);
    const wordCount = (text.match(/\S+/g) || []).length;
    const readingTime = `${Math.max(1, Math.round(wordCount / 200))} min read`;

    return {
      title,
      description,
      hook: description.slice(0, 160),
      body,
      tags,
      category,
      readingTime,
      contentType: 'article',
      meta: { pages: document_.numPages, info, wordCount }
    };
  }

  return { extractPdfDraft, pickTitle, textToMarkdown, suggestTags, guessCategory, normalizeText };
})();
