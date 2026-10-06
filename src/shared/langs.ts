/**
 * The most common words of a few languages: enough to tell which one a text is written in,
 * and to leave them out of keywords and summaries.
 */
export const STOPWORDS: Record<string, readonly string[]> = {
  fr: 'le la les un une des du de d l et est en que qui dans pour pas sur au aux avec ce ces cette il elle ils elles on nous vous je tu me te se sa son ses leur leurs mais ou donc or ni car ne plus tout tous très bien fait faire être avoir a ont été comme par si y alors aussi encore où quand même c ça qu j n s m t va vais là ici cela celui celle mon ma mes ton ta tes notre nos votre vos sont était peut voilà oui non ah oh euh hein bon ben quoi parce chez sans sous entre vers après avant deux trop peu'.split(' '),
  en: "the a an and or but of to in on at for with is are was were be been being it its this that these those i you he she we they me him her us them my your his our their not no yes so if then than as by from up down out about into over just very can could will would should do does did have has had there here what which who whom when where why how all any some more most other such only own same too also oh um uh yeah okay ok like well really get got going go know think gonna want".split(' '),
  es: 'el la los las un una unos unas de del y o pero que en a con por para es son era fue ser estar está están se su sus lo le les me te nos mi tu no sí muy más como cuando donde porque este esta estos estas ese esa eso al también ya hay todo todos pues bueno entonces'.split(' '),
  de: 'der die das den dem des ein eine einen einem einer und oder aber nicht ist sind war waren sein zu in im an am auf mit für von vom zum zur es er sie wir ihr ich du man auch so wie wenn dann noch nur schon sehr mehr hier da was wer wo warum ja nein ganz also doch mal eben jetzt habe hat haben wird werden kann können'.split(' '),
  it: 'il lo la i gli le un una uno di del della dei delle e o ma che in a da con per su non è sono era essere ha hanno ho si mi ti ci vi suo sua loro mio tuo questo questa quello quella come quando dove perché anche già più molto tutto tutti poi cosa allora sì no'.split(' '),
  pt: 'o a os as um uma uns umas de do da dos das e ou mas que em no na nos nas por para com não é são era ser estar está se seu sua seus suas me te nos meu minha muito mais como quando onde porque este esta isso isto aquele também já há tudo então sim'.split(' '),
  nl: 'de het een en of maar niet is zijn was waren te in op aan met voor van door bij uit naar dat die dit deze er hij zij wij jullie ik je u ze ook zo als dan nog al wel heel meer hier daar wat wie waar waarom ja nee heb heeft hebben wordt worden kan kunnen'.split(' '),
};

const SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v)])) as Record<string, Set<string>>;

/** The words of a text, lower case, letters and digits only ("l'école" → "l", "école"). */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function isStopword(word: string, lang?: string): boolean {
  if (lang && SETS[lang]) return SETS[lang]!.has(word);
  return Object.values(SETS).some((s) => s.has(word));
}

/** The language a text is most likely written in, when it is clear enough (else undefined). */
export function guessLang(text: string): string | undefined {
  const words = wordsOf(text).slice(0, 4000);
  if (words.length < 8) return undefined;
  let best: string | undefined;
  let bestHits = 0;
  let second = 0;
  for (const [lang, set] of Object.entries(SETS)) {
    const hits = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    if (hits > bestHits) {
      second = bestHits;
      bestHits = hits;
      best = lang;
    } else if (hits > second) second = hits;
  }
  // A real text uses its common words a lot, and more than another language's.
  return bestHits >= Math.max(3, words.length * 0.08) && bestHits > second * 1.3 ? best : undefined;
}

/** "fr-FR" → "fr". */
export const baseLang = (lang: string | undefined): string | undefined => lang?.toLowerCase().split(/[-_]/)[0] || undefined;
