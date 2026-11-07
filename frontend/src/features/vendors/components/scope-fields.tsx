import { useId } from 'react';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ErrorLine } from '@/ui/app-form';
import { Checkbox } from '@/ui/kit/checkbox';
import { Label } from '@/ui/kit/label';

import { BRIEF_SECTIONS, inSectionOrder } from '../scopes';
import type { BriefSection } from '../types';
import { useFieldText } from './shared';

interface ScopeFieldsProps<Values extends FieldValues> {
  control: Control<Values>;
  name: Path<Values>;
  /** Shown above the boxes: on booking, that the vendor's usual set is ticked to start with. */
  help: string;
}

interface SectionBoxProps {
  id: string;
  section: BriefSection;
  isTicked: boolean;
  onToggle: (isTicked: boolean) => void;
}

/** One section's box, its name and what it gives away; its 44 px press area is the kit's. */
function SectionBox({ id, section, isTicked, onToggle }: SectionBoxProps) {
  const { t } = useTranslation('vendors');
  return (
    <div className="flex items-start gap-3 py-1">
      <Checkbox
        id={id}
        className="mt-1"
        checked={isTicked}
        onCheckedChange={(state) => onToggle(state === true)}
        aria-describedby={`${id}-help`}
      />
      <div className="flex min-h-11 flex-col">
        <Label htmlFor={id} className="font-normal">
          {t(`scopes.${section}.label`)}
        </Label>
        <span id={`${id}-help`} className="text-muted-foreground text-sm">
          {t(`scopes.${section}.help`)}
        </span>
      </div>
    </div>
  );
}

/** What the vendor may read, one box per section, each saying what it gives away. */
export function ScopeFields<Values extends FieldValues>({
  control,
  name,
  help,
}: ScopeFieldsProps<Values>) {
  const { t } = useTranslation('vendors');
  const fieldText = useFieldText();
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const error = fieldText(fieldState.error);
        const ticked = field.value as BriefSection[];
        const toggle = (section: BriefSection, isTicked: boolean) =>
          field.onChange(
            inSectionOrder(
              isTicked ? [...ticked, section] : ticked.filter((each) => each !== section),
            ),
          );
        return (
          <fieldset
            className="m-0 flex flex-col gap-2 border-0 p-0"
            aria-describedby={error ? `${id}-error` : undefined}
          >
            <legend className="mb-1 p-0 text-sm font-medium">{t('scopes.legend')}</legend>
            <p className="text-muted-foreground m-0 text-sm">{help}</p>
            {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
            {BRIEF_SECTIONS.map((section) => (
              <SectionBox
                key={section}
                id={`${id}-${section}`}
                section={section}
                isTicked={ticked.includes(section)}
                onToggle={(isTicked) => toggle(section, isTicked)}
              />
            ))}
            {ticked.includes('contacts') ? (
              <p role="note" className="border-destructive m-0 border-l-2 pl-3 text-sm">
                {t('scopes.contactsWarning')}
              </p>
            ) : null}
            {ticked.length === 0 ? (
              <p role="note" className="border-border m-0 border-l-2 pl-3 text-sm">
                {t('scopes.none')}
              </p>
            ) : null}
          </fieldset>
        );
      }}
    />
  );
}
