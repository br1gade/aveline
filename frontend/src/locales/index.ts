import enCommon from './en/common.json';
import hyCommon from './hy/common.json';
import ruCommon from './ru/common.json';

/**
 * Every namespace in every language. English is the source of the keys; Armenian and Russian are
 * drafts until a native reader checks them (design PD-9).
 */
export const resources = {
  en: { common: enCommon },
  hy: { common: hyCommon },
  ru: { common: ruCommon },
} as const;
