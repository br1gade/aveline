import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// A test renders any page, so it has every page's words.
import '@/locales/app';
import '@/locales/guest';
import '@/locales/public';

// Vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(cleanup);

// A full run under load took longer than Testing Library's one second to draw a dialog or a list,
// and failed tests that pass alone (audit 20 Nov, A4-10). A missing element still fails, later.
configure({ asyncUtilTimeout: 3000 });

// jsdom has no ResizeObserver, which Radix primitives in src/ui/kit measure with. Browsers all do.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
