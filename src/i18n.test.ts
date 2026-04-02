import { describe, it, expect, vi } from 'vitest';
import { translations, detectLang } from './i18n';

describe('translations', () => {
  it('has all required keys for every language', () => {
    const requiredKeys = ['loading', 'errorTitle', 'errorDesc', 'timeout', 'networkError', 'dir'];
    for (const [lang, t] of Object.entries(translations)) {
      for (const key of requiredKeys) {
        expect(t).toHaveProperty(key);
        expect((t as Record<string, string>)[key], `${lang}.${key} should be non-empty`).toBeTruthy();
      }
    }
  });

  it('Farsi has rtl direction', () => {
    expect(translations.fa.dir).toBe('rtl');
  });

  it('non-Farsi languages have ltr direction', () => {
    expect(translations.ru.dir).toBe('ltr');
    expect(translations.en.dir).toBe('ltr');
    expect(translations.zh.dir).toBe('ltr');
  });
});

describe('detectLang', () => {
  it('returns "en" for unknown language', () => {
    vi.stubGlobal('navigator', { language: 'xx-XX' });
    expect(detectLang()).toBe('en');
    vi.unstubAllGlobals();
  });

  it('returns "ru" for Russian locale', () => {
    vi.stubGlobal('navigator', { language: 'ru-RU' });
    expect(detectLang()).toBe('ru');
    vi.unstubAllGlobals();
  });

  it('returns "fa" for Farsi locale', () => {
    vi.stubGlobal('navigator', { language: 'fa-IR' });
    expect(detectLang()).toBe('fa');
    vi.unstubAllGlobals();
  });

  it('returns "zh" for Chinese locale', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    expect(detectLang()).toBe('zh');
    vi.unstubAllGlobals();
  });

  it('defaults to "en" when navigator.language is empty', () => {
    vi.stubGlobal('navigator', { language: '' });
    expect(detectLang()).toBe('en');
    vi.unstubAllGlobals();
  });
});
