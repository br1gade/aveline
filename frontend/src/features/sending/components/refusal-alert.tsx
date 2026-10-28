import { ProblemAlert } from '@/ui/app-form';

import { useRefusedText, type LifecycleAction, type Refusal } from '../refusals';

/** Our words for a refusal, then the backend's sentences in English, marked as English. */
export function RefusalAlert({ refusal, action }: { refusal: Refusal; action: LifecycleAction }) {
  const refused = useRefusedText(action);
  return (
    <ProblemAlert
      problem={refusal.problem}
      refused={(status) => (
        <>
          {refused(status)}
          {refusal.messages.map((message) => (
            <span key={message} lang="en" className="block">
              {message}
            </span>
          ))}
        </>
      )}
    />
  );
}
