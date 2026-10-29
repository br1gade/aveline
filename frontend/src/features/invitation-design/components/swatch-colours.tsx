import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ErrorLine } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { SectionFormValues } from '../form-model';
import { useFieldText } from '../use-field-text';

/** A new swatch starts white; the browser's own colour picker changes it. */
const NEW_COLOUR = '#ffffff';

/**
 * The dress code's suggested colours (design PD-57): the browser's own colour picker for each,
 * with its value written beside it, since a colour cannot be named in words (PD-26). Guests see
 * them as small squares under the text, which carries the actual guidance.
 */
export function SwatchColours({ form }: { form: UseFormReturn<SectionFormValues> }) {
  const { t } = useTranslation('design');
  const fieldText = useFieldText();
  const colours = useWatch({ control: form.control, name: 'colours' });
  const errors = form.formState.errors.colours;
  const set = (next: string[]) => form.setValue('colours', next, { shouldDirty: true });
  return (
    <fieldset className="border-border m-0 flex min-w-0 flex-col gap-3 border px-5 pt-3 pb-5">
      <legend className="px-1 text-base font-medium">{t('section.colours')}</legend>
      <p className="text-muted-foreground m-0 text-sm">{t('section.coloursHelp')}</p>
      {colours.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {colours.map((colour, position) => (
            <li key={position} className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-3">
                <span>{t('section.colour', { number: position + 1 })}</span>
                <input
                  type="color"
                  value={colour}
                  className="border-input h-11 w-16 cursor-pointer border bg-transparent p-1"
                  onChange={(change) =>
                    set(
                      colours.map((current, at) =>
                        at === position ? change.target.value : current,
                      ),
                    )
                  }
                />
              </label>
              <span className="text-muted-foreground font-mono text-sm">{colour}</span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => set(colours.filter((_, at) => at !== position))}
              >
                {t('section.removeColour', { number: position + 1 })}
              </Button>
              {errors?.[position] ? (
                <ErrorLine id={`colour-${position}-error`}>{fieldText(errors[position])}</ErrorLine>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => set([...colours, NEW_COLOUR])}
      >
        {t('section.addColour')}
      </Button>
    </fieldset>
  );
}
