/**
 * Keyword safety net for urgent issues. Model-independent and multilingual, so a clear "cockroach"
 * or "my bag was stolen" is flagged whichever AI (or none) processed the review. Only the guest's
 * complaint text and title are scanned — never the "liked" text — and simple negations are skipped.
 * Price slang ("robo", "rip-off", "a steal") deliberately does not count as theft.
 */
// Unicode-aware word boundaries (\b only understands Latin letters, so Cyrillic etc. would never match).
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const rule = (reason: string, words: string, cjk = '') => ({ reason, pattern: new RegExp(`${B}(?:${words})${E}${cjk ? `|${cjk}` : ''}`, 'iu') });

const RULES: { reason: string; pattern: RegExp }[] = [
  rule(
    'Guest mentions pests',
    'cockroach(?:es)?|roach(?:es)?|bed ?bugs?|rats?|mice|rodents?|mouse droppings|cucarachas?|chinches?|cafards?|punaises? de lit|kakerlaken?|bettwanzen?|scarafagg\\p{L}*|cimici|baratas?|percevejos?|тарака\\p{L}*|клоп\\p{L}*|karaluch\\p{L}*|pluskw\\p{L}*',
    '蟑螂|床虱|臭虫|ゴキブリ|南京虫|바퀴벌레|빈대',
  ),
  rule(
    'Guest reports theft or a break-in',
    "stolen|stole|robbed|theft|thie(?:f|ves)|broke in(?:to)?|break[- ]ins?|okradzion\\p{L}*|okradl\\p{L}*|me robaron|robaron|nos robaron|robado|on m'a vol[ée]|gestohlen|beklaut|rubat[oaie]|derubat\\p{L}*|furto",
    '被偷|盗まれ',
  ),
  rule(
    'Guest reports a broken or insecure lock',
    "(?:broken|faulty)\\s+(?:door\\s+)?lock|lock\\s+(?:was\\s+|is\\s+)?(?:broken|not working|didn'?t work|doesn'?t work)|door\\s+(?:didn'?t|doesn'?t|wouldn'?t|did not|does not)\\s+lock",
  ),
];

const NEGATION_BEFORE = /(?<![\p{L}])(no|not|never|without|zero|any|didn'?t see|haven'?t seen|sin|ningun[ao]?|pas de|aucun\p{L}*|keine?n?|nessun\p{L}*|нет|без)(?![\p{L}])[^.!?]{0,20}$/iu;

/** Returns a short reason when the complaint text clearly describes an urgent issue, else null. */
export function urgentRuleHit(title: string | null, negativeText: string | null): string | null {
  const text = [negativeText, title].filter(Boolean).join(' . ');
  if (!text) return null;
  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
      if (!NEGATION_BEFORE.test(before)) return rule.reason;
    }
  }
  return null;
}
