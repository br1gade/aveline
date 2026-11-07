/**
 * Recording an answer a guest gave by phone or in person (docs/API.md §6; design PD-108), for one
 * guest or a whole household (PD-147). It reads guests and the invitation's questions, so it sits
 * above `guests` and `invitation-design`. Every read is in the browser, so there is no
 * `index.server.ts`.
 */
export { HouseholdAnswersPage } from './components/household-answers-page';
export { RecordAnswerPage } from './components/record-answer-page';
export {
  loadHouseholdAnswers,
  loadRecordAnswer,
  type HouseholdAnswersData,
  type RecordAnswerData,
} from './load';
