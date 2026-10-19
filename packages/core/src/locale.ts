import { CHAPTER_LANGUAGES, DEFAULT_CHAPTER_LANGUAGE } from './languages.js'

/**
 * What a chapter page says, in the language the chapter is in (docs/12).
 *
 * A German chapter lives at its own URL and is read by German readers, so serving it an
 * English `<title>`, an English meta description and an English "Chapter 1196" is three
 * wasted signals: the page competes for English queries it cannot win and loses the German
 * ones it should. This is the per-language half of the chapter's metadata.
 *
 * Only the chapter-facing strings are here, not the interface. The reader's buttons are
 * chrome a visitor skims past; the chapter's *title* is what they search for and what
 * Google indexes, and it is also the one string a reader reads before deciding to stay.
 */

export interface ChapterLocale {
  /** BCP-47 code, matching `CHAPTER_LANGUAGES`. */
  code: string
  /** `og:locale`, which Facebook and friends want as `xx_XX` rather than a bare tag. */
  ogLocale: string
  /**
   * How this language writes "Chapter 1196".
   *
   * A pattern rather than a word, because not every language puts a word in front of the
   * number: Japanese wraps it (第1196話), Korean suffixes it (1196화), and a table of nouns
   * would have produced "Chapter 第話" for both.
   */
  label: string
  /** The chapter page's `<title>` and meta description, in this language. */
  seo: { title: string; description: string }
  /** The "what comes before and after" sentence in the description. */
  previous: string
  next: string
}

/**
 * One entry per language an uploader can pick. A test holds the two lists in step, because
 * a language added to the picker without strings here would quietly serve English.
 *
 * Machine-quality translations of six short strings, not a localisation pass: they are a
 * clear improvement on serving English to everyone, and they are all in one table for a
 * native speaker to correct in a single edit when a language starts to matter.
 */
export const CHAPTER_LOCALES: readonly ChapterLocale[] = [
  {
    code: 'en',
    ogLocale: 'en_US',
    label: 'Chapter {n}',
    seo: {
      title: '{title} Chapter {chapter} {sep} {site}',
      description: 'Read {title} Chapter {chapter} online free at {site}. {next_prev_hint}',
    },
    previous: 'Previous: Chapter {n}.',
    next: 'Next: Chapter {n}.',
  },
  {
    code: 'de',
    ogLocale: 'de_DE',
    label: 'Kapitel {n}',
    seo: {
      title: '{title} Kapitel {chapter} {sep} {site}',
      description: 'Lies {title} Kapitel {chapter} kostenlos online auf {site}. {next_prev_hint}',
    },
    previous: 'Vorheriges: Kapitel {n}.',
    next: 'Nächstes: Kapitel {n}.',
  },
  {
    code: 'es',
    ogLocale: 'es_ES',
    label: 'Capítulo {n}',
    seo: {
      title: '{title} Capítulo {chapter} {sep} {site}',
      description: 'Lee {title} Capítulo {chapter} gratis en línea en {site}. {next_prev_hint}',
    },
    previous: 'Anterior: Capítulo {n}.',
    next: 'Siguiente: Capítulo {n}.',
  },
  {
    code: 'pt-BR',
    ogLocale: 'pt_BR',
    label: 'Capítulo {n}',
    seo: {
      title: '{title} Capítulo {chapter} {sep} {site}',
      description: 'Leia {title} Capítulo {chapter} online grátis em {site}. {next_prev_hint}',
    },
    previous: 'Anterior: Capítulo {n}.',
    next: 'Próximo: Capítulo {n}.',
  },
  {
    code: 'pt',
    ogLocale: 'pt_PT',
    label: 'Capítulo {n}',
    seo: {
      title: '{title} Capítulo {chapter} {sep} {site}',
      description: 'Lê {title} Capítulo {chapter} online grátis em {site}. {next_prev_hint}',
    },
    previous: 'Anterior: Capítulo {n}.',
    next: 'Próximo: Capítulo {n}.',
  },
  {
    code: 'fr',
    ogLocale: 'fr_FR',
    label: 'Chapitre {n}',
    seo: {
      title: '{title} Chapitre {chapter} {sep} {site}',
      description:
        'Lisez {title} Chapitre {chapter} gratuitement en ligne sur {site}. {next_prev_hint}',
    },
    previous: 'Précédent : Chapitre {n}.',
    next: 'Suivant : Chapitre {n}.',
  },
  {
    code: 'it',
    ogLocale: 'it_IT',
    label: 'Capitolo {n}',
    seo: {
      title: '{title} Capitolo {chapter} {sep} {site}',
      description: 'Leggi {title} Capitolo {chapter} gratis online su {site}. {next_prev_hint}',
    },
    previous: 'Precedente: Capitolo {n}.',
    next: 'Successivo: Capitolo {n}.',
  },
  {
    code: 'nl',
    ogLocale: 'nl_NL',
    label: 'Hoofdstuk {n}',
    seo: {
      title: '{title} Hoofdstuk {chapter} {sep} {site}',
      description: 'Lees {title} Hoofdstuk {chapter} gratis online op {site}. {next_prev_hint}',
    },
    previous: 'Vorige: Hoofdstuk {n}.',
    next: 'Volgende: Hoofdstuk {n}.',
  },
  {
    code: 'pl',
    ogLocale: 'pl_PL',
    label: 'Rozdział {n}',
    seo: {
      title: '{title} Rozdział {chapter} {sep} {site}',
      description: 'Czytaj {title} Rozdział {chapter} za darmo online na {site}. {next_prev_hint}',
    },
    previous: 'Poprzedni: Rozdział {n}.',
    next: 'Następny: Rozdział {n}.',
  },
  {
    code: 'ru',
    ogLocale: 'ru_RU',
    label: 'Глава {n}',
    seo: {
      title: '{title} Глава {chapter} {sep} {site}',
      description: 'Читайте {title} Глава {chapter} онлайн бесплатно на {site}. {next_prev_hint}',
    },
    previous: 'Предыдущая: Глава {n}.',
    next: 'Следующая: Глава {n}.',
  },
  {
    code: 'uk',
    ogLocale: 'uk_UA',
    label: 'Розділ {n}',
    seo: {
      title: '{title} Розділ {chapter} {sep} {site}',
      description:
        'Читайте {title} Розділ {chapter} онлайн безкоштовно на {site}. {next_prev_hint}',
    },
    previous: 'Попередній: Розділ {n}.',
    next: 'Наступний: Розділ {n}.',
  },
  {
    code: 'tr',
    ogLocale: 'tr_TR',
    label: 'Bölüm {n}',
    seo: {
      title: '{title} Bölüm {chapter} {sep} {site}',
      description: '{title} Bölüm {chapter} {site} üzerinde ücretsiz online oku. {next_prev_hint}',
    },
    previous: 'Önceki: Bölüm {n}.',
    next: 'Sonraki: Bölüm {n}.',
  },
  {
    code: 'id',
    ogLocale: 'id_ID',
    label: 'Bab {n}',
    seo: {
      title: '{title} Bab {chapter} {sep} {site}',
      description: 'Baca {title} Bab {chapter} online gratis di {site}. {next_prev_hint}',
    },
    previous: 'Sebelumnya: Bab {n}.',
    next: 'Selanjutnya: Bab {n}.',
  },
  {
    code: 'vi',
    ogLocale: 'vi_VN',
    label: 'Chương {n}',
    seo: {
      title: '{title} Chương {chapter} {sep} {site}',
      description: 'Đọc {title} Chương {chapter} miễn phí online tại {site}. {next_prev_hint}',
    },
    previous: 'Trước: Chương {n}.',
    next: 'Tiếp theo: Chương {n}.',
  },
  {
    code: 'th',
    ogLocale: 'th_TH',
    label: 'ตอนที่ {n}',
    seo: {
      title: '{title} ตอนที่ {chapter} {sep} {site}',
      description: 'อ่าน {title} ตอนที่ {chapter} ออนไลน์ฟรีที่ {site} {next_prev_hint}',
    },
    previous: 'ก่อนหน้า: ตอนที่ {n}.',
    next: 'ถัดไป: ตอนที่ {n}.',
  },
  {
    code: 'fil',
    ogLocale: 'fil_PH',
    label: 'Kabanata {n}',
    seo: {
      title: '{title} Kabanata {chapter} {sep} {site}',
      description:
        'Basahin ang {title} Kabanata {chapter} online nang libre sa {site}. {next_prev_hint}',
    },
    previous: 'Nakaraan: Kabanata {n}.',
    next: 'Susunod: Kabanata {n}.',
  },
  {
    code: 'ja',
    ogLocale: 'ja_JP',
    label: '第{n}話',
    seo: {
      title: '{title} 第{chapter}話 {sep} {site}',
      description: '{title} 第{chapter}話を{site}で無料で読む。{next_prev_hint}',
    },
    previous: '前: 第{n}話。',
    next: '次: 第{n}話。',
  },
  {
    code: 'ko',
    ogLocale: 'ko_KR',
    label: '{n}화',
    seo: {
      title: '{title} {chapter}화 {sep} {site}',
      description: '{title} {chapter}화를 {site}에서 무료로 보세요. {next_prev_hint}',
    },
    previous: '이전: {n}화.',
    next: '다음: {n}화.',
  },
  {
    code: 'zh',
    ogLocale: 'zh_CN',
    label: '第{n}话',
    seo: {
      title: '{title} 第{chapter}话 {sep} {site}',
      description: '在{site}免费在线阅读{title}第{chapter}话。{next_prev_hint}',
    },
    previous: '上一话：第{n}话。',
    next: '下一话：第{n}话。',
  },
  {
    code: 'zh-Hant',
    ogLocale: 'zh_TW',
    label: '第{n}話',
    seo: {
      title: '{title} 第{chapter}話 {sep} {site}',
      description: '在{site}免費線上閱讀{title}第{chapter}話。{next_prev_hint}',
    },
    previous: '上一話：第{n}話。',
    next: '下一話：第{n}話。',
  },
  {
    code: 'ar',
    ogLocale: 'ar_AR',
    label: 'الفصل {n}',
    seo: {
      title: '{title} الفصل {chapter} {sep} {site}',
      description: 'اقرأ {title} الفصل {chapter} مجانًا على {site}. {next_prev_hint}',
    },
    previous: 'السابق: الفصل {n}.',
    next: 'التالي: الفصل {n}.',
  },
  {
    code: 'hi',
    ogLocale: 'hi_IN',
    label: 'अध्याय {n}',
    seo: {
      title: '{title} अध्याय {chapter} {sep} {site}',
      description: '{site} पर {title} अध्याय {chapter} मुफ़्त ऑनलाइन पढ़ें। {next_prev_hint}',
    },
    previous: 'पिछला: अध्याय {n}.',
    next: 'अगला: अध्याय {n}.',
  },
] as const

const BY_CODE = new Map(CHAPTER_LOCALES.map((l) => [l.code, l]))

/** The English entry, which is also the fallback and is guaranteed to exist. */
export const DEFAULT_CHAPTER_LOCALE: ChapterLocale =
  BY_CODE.get(DEFAULT_CHAPTER_LANGUAGE) ?? (CHAPTER_LOCALES[0] as ChapterLocale)

export const chapterLocale = (code: string | null | undefined): ChapterLocale =>
  BY_CODE.get(code ?? '') ?? DEFAULT_CHAPTER_LOCALE

/** `('de', '1196')` → `Kapitel 1196`. The number is pre-formatted by the caller. */
export const localeChapterLabel = (code: string | null | undefined, number: string): string =>
  chapterLocale(code).label.replaceAll('{n}', number)

/**
 * "Previous: Chapter 1195. Next: Chapter 1197.", in the chapter's language.
 *
 * Part of the description rather than a separate field because that is where it earns its
 * place: it is the sentence that tells a search engine this page sits in a series, and it
 * is why a chapter page ranks for the chapter either side of it.
 */
export const localeChapterHint = (
  code: string | null | undefined,
  previous: string | null,
  next: string | null,
): string => {
  const locale = chapterLocale(code)
  const parts: string[] = []
  if (previous) parts.push(locale.previous.replaceAll('{n}', previous))
  if (next) parts.push(locale.next.replaceAll('{n}', next))
  return parts.join(' ')
}

/** Every language the picker offers has strings here; this is what the test checks. */
export const languagesWithoutLocale = (): string[] =>
  CHAPTER_LANGUAGES.filter((l) => !BY_CODE.has(l.code)).map((l) => l.code)
