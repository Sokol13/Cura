import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

export const i18n = createInstance();

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en'],
  interpolation: { escapeValue: false },
  resources: {
    'zh-CN': {
      translation: {
        environment: '开发环境',
        ready: '阶段 0：开发环境与基础脚手架已就绪。',
      },
    },
    en: {
      translation: {
        environment: 'Development environment',
        ready: 'Phase 0: The development environment and scaffold are ready.',
      },
    },
  },
});
