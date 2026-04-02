export type Lang = 'ru' | 'en' | 'fa' | 'zh';

export interface Translations {
  loading: string;
  errorTitle: string;
  errorDesc: string;
  timeout: string;
  networkError: string;
  dir: 'ltr' | 'rtl';
}

export const translations: Record<Lang, Translations> = {
  ru: {
    loading: 'Проверка подписи…',
    errorTitle: '⚠ ПОДПИСЬ НЕ ПРОШЛА ПРОВЕРКУ',
    errorDesc: 'Страница была изменена или подделана.',
    timeout: 'Превышено время ожидания сервера.',
    networkError: 'Ошибка сети',
    dir: 'ltr',
  },
  en: {
    loading: 'Verifying signature…',
    errorTitle: '⚠ SIGNATURE VERIFICATION FAILED',
    errorDesc: 'The page has been modified or forged.',
    timeout: 'Server request timed out.',
    networkError: 'Network error',
    dir: 'ltr',
  },
  fa: {
    loading: 'در حال تأیید امضا…',
    errorTitle: '⚠ تأیید امضا ناموفق بود',
    errorDesc: 'صفحه تغییر کرده یا جعل شده است.',
    timeout: 'زمان انتظار سرور به پایان رسید.',
    networkError: 'خطای شبکه',
    dir: 'rtl',
  },
  zh: {
    loading: '正在验证签名…',
    errorTitle: '⚠ 签名验证失败',
    errorDesc: '该页面已被修改或伪造。',
    timeout: '服务器请求超时。',
    networkError: '网络错误',
    dir: 'ltr',
  },
};

export function detectLang(): Lang {
  const code = (navigator.language || 'en').toLowerCase().split('-')[0];
  return (code in translations ? code : 'en') as Lang;
}
