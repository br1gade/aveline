import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// A test renders any page, so it has every page's words.
import '@/locales/app';
import '@/locales/guest';
import '@/locales/public';

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(cleanup);

// jsdom has no ResizeObserver, which Radix primitives in src/ui/kit measure with. Browsers all do.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
