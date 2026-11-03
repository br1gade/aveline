import { useTranslation } from 'react-i18next';

import { LoadedProblem } from '@/features/sending';
import { SelectField } from '@/ui/app-form';
import { NativeSelectOption, NativeSelectOptGroup } from '@/ui/kit/native-select';

import { hallsByCity } from '../directory';
import type { NewVenueData } from '../load';
import type { DirectoryHall } from '../types';
import type { VenueForm } from './venue-fields';

interface DirectoryPickerProps {
  directory: NewVenueData['directory'];
  form: VenueForm;
  hall: DirectoryHall | null;
  onChoose: (hall: DirectoryHall | null) => void;
}

/**
 * Starting a venue from the shared directory (design PD-101). Optional: choosing fills the name and
 * address, still editable, and the server copies the hall's coordinates and capacity. An empty
 * directory says nothing, since neither seed creates a hall and hosts can't add one.
 */
export function DirectoryPicker({ directory, form, hall, onChoose }: DirectoryPickerProps) {
  const { t } = useTranslation('venues');
  if (directory.kind !== 'ready') {
    return <LoadedProblem loaded={directory} refusedText={t('directory.pick.refused')} />;
  }
  const halls = directory.value;
  if (halls.length === 0) return null;
  const choose = (id: string) => {
    const chosen = halls.find((candidate) => candidate.id === id) ?? null;
    onChoose(chosen);
    if (chosen) {
      form.setValue('name', chosen.name);
      form.setValue('address', chosen.address);
      form.clearErrors(['name', 'address']);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label={t('directory.pick.label')}
        help={t('directory.pick.help')}
        value={hall?.id ?? ''}
        onChange={(event) => choose(event.target.value)}
      >
        <NativeSelectOption value="">{t('directory.pick.none')}</NativeSelectOption>
        {hallsByCity(halls).map(({ city, halls: inCity }) => (
          <NativeSelectOptGroup key={city ?? ''} label={city ?? t('directory.noCity')}>
            {inCity.map((candidate) => (
              <NativeSelectOption key={candidate.id} value={candidate.id}>
                {candidate.name}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        ))}
      </SelectField>
      {hall ? (
        <p className="text-muted-foreground m-0 text-sm">
          {[
            hall.operatorName ? t('directory.runBy', { name: hall.operatorName }) : '',
            hall.capacity ? t('directory.capacity', { count: hall.capacity }) : '',
            t('directory.pick.copied'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
    </div>
  );
}
