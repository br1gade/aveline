/**
 * The production server's way in. React picks its development or production build when it is first
 * imported, and imports run before a module's own code, so the mode is set here, before any of them.
 */
process.env.NODE_ENV ??= 'production';
await import('./serve.ts');

export {};
