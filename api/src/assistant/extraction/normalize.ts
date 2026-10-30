function digitsToAscii(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.codePointAt(0)!;
    return code <= 0x0669 ? String(code - 0x0660) : String(code - 0x06f0);
  });
}

export function normalizeText(s: string): string {
  let out = s.normalize('NFKC');
  out = digitsToAscii(out);
  out = out.replace(/[ـً-ٰٟ]/g, ''); // tatweel + diacritics
  out = out.replace(/[‘’]/g, "'");
  out = out.replace(/[“”]/g, '"');
  out = out.replace(/[–—]/g, '-');
  out = out.toLowerCase();
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

export function quoteExists(quote: string, source: string): boolean {
  const normalizedQuote = normalizeText(quote);
  if (normalizedQuote === '') return false;
  return normalizeText(source).includes(normalizedQuote);
}

// Order matters: longer/more specific alternatives are tried first at each position,
// so the dual "مليونين" (two million) is matched before the plain "مليون" (million).
const AMOUNT_PATTERN =
  /(?<enNum>\d+(?:\.\d+)?)\s*(?<enMult>k|mn|m|million)\b|(?<afNum>\d+(?:\.\d+)?)\s*(?:ألف|الف)|مليونين|(?<mnNum>\d+(?:\.\d+)?)?\s*مليون(?!ين)|(?<bareComma>\b\d{1,3}(?:,\d{3})+\b)|(?<barePlain>\b\d{4,}\b)/gi;

function amountFromMatch(match: RegExpMatchArray): number {
  const groups = match.groups ?? {};
  if (groups.enNum !== undefined) {
    const n = parseFloat(groups.enNum);
    return groups.enMult === 'k' ? n * 1_000 : n * 1_000_000;
  }
  if (groups.afNum !== undefined) {
    return parseFloat(groups.afNum) * 1_000;
  }
  if (match[0].includes('مليونين')) {
    return 2_000_000;
  }
  if (match[0].includes('مليون')) {
    const n = groups.mnNum !== undefined ? parseFloat(groups.mnNum) : 1;
    return n * 1_000_000;
  }
  if (groups.bareComma !== undefined) {
    return Number(groups.bareComma.replace(/,/g, ''));
  }
  return Number(groups.barePlain);
}

export function parseAmount(text: string): number | null {
  const matches = [...normalizeText(text).matchAll(AMOUNT_PATTERN)];
  if (matches.length !== 1) return null;
  return amountFromMatch(matches[0]);
}

export function amountMatchesEvidence(value: number, quote: string): boolean {
  const parsed = parseAmount(quote);
  return parsed === null || parsed === value;
}
