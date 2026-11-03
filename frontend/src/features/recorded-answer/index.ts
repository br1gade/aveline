/**
 * Recording an answer a guest gave by phone or in person (docs/API.md §6; design PD-108). It reads
 * one guest and the invitation's questions, so it sits above `guests` and `invitation-design`. Every
 * read is in the browser, so there is no `index.server.ts`.
 */
export { RecordAnswerPage } from './components/record-answer-page';
export { loadRecordAnswer, type RecordAnswerData } from './load';
