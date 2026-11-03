// The account and app forms' shared pieces: one implementation of the PD-41 guard, the problem
// alert, and the labelled fields (docs/ARCHITECTURE.md §8).
export { AppForm } from './app-form';
export { ProblemAlert } from './problem-alert';
export { ErrorLine, SelectField } from './select-field';
export { SubmitButton } from './submit-button';
export { TextInputField } from './text-input-field';
export { usePageStatus, type PageActions } from './page-status';
export { StatusLine } from './status-line';
export { useDialogOpener } from './use-dialog-opener';
export { WordedRefusal } from './worded-refusal';

/** The kit's buttons never wrap; a long label in Armenian or Russian must, at 360 px. */
export const WRAPPING_BUTTON =
  'h-auto min-h-10 py-2 whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-11';
