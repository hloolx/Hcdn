import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/en";

/**
 * Chinese is the source language: UI strings are written in Chinese and used
 * directly as translation keys. English entries live in i18n/en.ts; a missing
 * entry falls back to the Chinese text.
 */
export type Lang = "zh" | "en";

const STORAGE_KEY = "hcdn-lang";

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "zh") return v;
  } catch {
    /* ignore */
  }
  return "zh";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: initialLang(),
  fallbackLng: false,
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

document.documentElement.lang = i18n.language === "en" ? "en" : "zh-CN";

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  void i18n.changeLanguage(lang);
}

export function currentLocale(): string {
  return i18n.language === "en" ? "en-US" : "zh-CN";
}

export default i18n;
