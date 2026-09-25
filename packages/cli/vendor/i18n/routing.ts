import { defineRouting } from "next-intl/routing";

export const LOCALE_COOKIE = {
  name: "NEXT_LOCALE",
  path: "/",
  sameSite: "lax",
} as const;

export const routing = defineRouting({
  locales: [
    "en",
    "id",
    "ru",
    "es",
    "ja",
    "ko",
    "zh-hant",
    "zh-hans",
    "de",
    "fr",
    "hi",
    "pt",
    "vi",
  ],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeCookie: LOCALE_COOKIE,
  // Page metadata is the sole hreflang source. Disabling response-header
  // alternates prevents invalid locale variants from leaking onto 404/noindex
  // responses while keeping canonical pages fully linked in HTML.
  alternateLinks: false,
});

export type AppLocale = (typeof routing.locales)[number];

export const htmlLanguageByLocale: Readonly<Record<AppLocale, string>> = {
  en: "en",
  id: "id",
  ru: "ru",
  es: "es",
  ja: "ja",
  ko: "ko",
  "zh-hant": "zh-Hant",
  "zh-hans": "zh-Hans",
  de: "de",
  fr: "fr",
  hi: "hi",
  pt: "pt-BR",
  vi: "vi",
};
