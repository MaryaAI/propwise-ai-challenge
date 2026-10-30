import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { amountMatchesEvidence, normalizeText, parseAmount, quoteExists } from './normalize';

interface LeadSeed {
  key: string;
  messages: { body: string }[];
}

const SEED_DIR = join(__dirname, '..', '..', '..', '..', 'seed');

function readSeed<T>(file: string): T {
  return JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8')) as T;
}

const leads = readSeed<LeadSeed[]>('leads.json');

function bodyOf(key: string, index = 0): string {
  const lead = leads.find((l) => l.key === key);
  if (!lead) throw new Error(`No seed lead with key "${key}"`);
  return lead.messages[index].body;
}

describe('quoteExists against real seed messages', () => {
  it.each<[string, string, number]>([
    ['karim', '2-bedroom apartment in Dubai Marina', 0],
    ['karim', 'around 2M AED', 0],
    ['karim', 'tomorrow', 0],
    ['fatima', 'بغرفتين', 0],
    ['fatima', 'دبي مارينا', 0],
    ['fatima', 'حوالي ٢ مليون درهم', 0],
    ['fatima', 'غداً', 0],
    ['alex', 'studio or 1-bed in JVC', 0],
    ['alex', 'under 900k', 0],
    ['james', 'after the weekend', 1],
    ['james', 'up to 1.5M', 1],
    ['lina', '5-bedroom villa', 0],
    ['lina', 'under 900k AED', 0],
    ['priya', 'rent a 2-bed', 0],
  ])('%s: "%s" is found in the real message body', (key, quote, index) => {
    expect(quoteExists(quote, bodyOf(key, index))).toBe(true);
  });

  it('a quote not present in the message returns false', () => {
    expect(quoteExists('3-bedroom', bodyOf('karim'))).toBe(false);
  });

  it('an empty quote returns false', () => {
    expect(quoteExists('', bodyOf('karim'))).toBe(false);
  });

  it('a tatweel-inserted word still matches its plain form after normalization', () => {
    expect(quoteExists('مليون', 'أبحث عن شقة بميزانية مـليون درهم')).toBe(true);
  });
});

describe('normalizeText', () => {
  it('converts Arabic-Indic and Persian digits to ASCII', () => {
    expect(normalizeText('٢٥')).toBe('25');
    expect(normalizeText('۲۵')).toBe('25');
  });

  it('removes tatweel and Arabic diacritics', () => {
    expect(normalizeText('مـليون')).toBe('مليون');
    expect(normalizeText('مُحَمَّد')).toBe('محمد');
  });

  it('straightens curly quotes and dashes, lowercases, and collapses whitespace', () => {
    expect(normalizeText('  “Hello”   World–Test  ')).toBe('"hello" world-test');
  });
});

describe('parseAmount', () => {
  it.each<[string, number | null]>([
    ['2M', 2_000_000],
    ['2m', 2_000_000],
    ['2 million', 2_000_000],
    ['1.5M', 1_500_000],
    ['900k', 900_000],
    ['900K', 900_000],
    ['2,000,000', 2_000_000],
    ['2000000', 2_000_000],
    ['120k a year', 120_000],
    ['about 120k a year for a 2-bed', 120_000],
    ['٢ مليون', 2_000_000],
    ['حوالي ٢ مليون درهم', 2_000_000],
    ['مليونين', 2_000_000],
    ['مليون', 1_000_000],
    ['900 ألف', 900_000],
    ['900 الف', 900_000],
    ['between 1.5M and 2M', null],
    ['2-bed', null],
  ])('parseAmount(%j) -> %j', (text, expected) => {
    expect(parseAmount(text)).toBe(expected);
  });
});

describe('amountMatchesEvidence', () => {
  it('matches when the quote parses to the same value', () => {
    expect(amountMatchesEvidence(2_000_000, 'around 2M AED')).toBe(true);
  });

  it('does not match when the quote parses to a different value', () => {
    expect(amountMatchesEvidence(3_000_000, 'around 2M AED')).toBe(false);
  });
});
