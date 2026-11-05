import { forwardRef, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { SelectField } from '@/ui/app-form';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { ORGANIZATION_ROLES, type OrganizationRole } from '../types';

interface RoleFieldProps extends Omit<ComponentProps<typeof SelectField>, 'label' | 'help'> {
  label: string;
  /** What the chosen role allows is said under the field. */
  chosen: OrganizationRole | null;
}

/** One list of roles, with what the chosen one may do. A role this client doesn't know has no words. */
export const RoleField = forwardRef<HTMLSelectElement, RoleFieldProps>(function RoleField(
  { chosen, ...select },
  ref,
) {
  const { t } = useTranslation('organization');
  return (
    <SelectField ref={ref} help={chosen ? t(`role.${chosen}.about`) : undefined} {...select}>
      {chosen === null ? (
        <NativeSelectOption value="" disabled>
          {t('role.unknown')}
        </NativeSelectOption>
      ) : null}
      {ORGANIZATION_ROLES.map((role) => (
        <NativeSelectOption key={role} value={role}>
          {t(`role.${role}.name`)}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
});
