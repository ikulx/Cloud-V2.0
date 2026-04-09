import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de'
import en from './en'
import it from './it'
import fr from './fr'

const savedLang = localStorage.getItem('lang') ?? 'de'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      en: { translation: en },
      it: { translation: it },
      fr: { translation: fr },
    },
    lng: savedLang,
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
