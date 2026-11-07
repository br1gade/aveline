import { fieldId } from '../fields';
import { DrawingPad } from './drawing-pad';
import { useFieldError, useReplyForm } from './form-context';

/** The reply form's drawn signature for one statement: the pad, bound to the form's values. */
export function SignaturePad({ questionId }: { questionId: string }) {
  const { form, signing } = useReplyForm();
  const path = `signatures.${questionId}` as const;
  const error = useFieldError(`${path}.assetId`);
  return (
    <DrawingPad
      binding={{
        id: fieldId(`${path}.assetId`),
        error,
        signing,
        currentAssetId: () => form.getValues(`${path}.assetId`),
        setAssetId: (assetId) =>
          form.setValue(`${path}.assetId`, assetId, {
            shouldValidate: assetId !== '' && form.formState.isSubmitted,
          }),
        typeInstead: () => form.setValue(`${path}.method`, 'TYPED'),
      }}
    />
  );
}
