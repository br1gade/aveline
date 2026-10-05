// @ts-check
//
// Frontend lint rules. Deliberately empty until a stack is chosen — the
// framework plugin (React, Vue, Svelte) decides most of what belongs here.
//
// When filling it in, carry across the rules from backend/eslint.config.mjs
// that are about judgement rather than language, because they are the ones
// that keep a codebase readable:
//
//   complexity, max-depth, max-lines-per-function, max-params
//   naming-convention, with booleans named as assertions
//   no-floating-promises and no-misused-promises
//
// Plus the ones only a client needs:
//
//   jsx-a11y (or the framework's equivalent) — guests open these pages on
//   every kind of device, and an invitation that a screen reader cannot read
//   is a broken invitation
//   exhaustive-deps, if the framework has hooks
//   no-restricted-globals for parseFloat on money — see docs/API.md §1
//
// Rules are binding, not advisory: backend/CLAUDE.md §9 requires zero
// warnings, and the same should hold here.

export default [];
