import type { resources } from './index';

// Typed keys: a missing or misspelt key fails the typecheck.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof resources)['en'];
  }
}
