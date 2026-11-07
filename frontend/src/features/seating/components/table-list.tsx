import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/kit/button';

import type { SeatingTable } from '../types';
import { WRAP } from './shared';
import { TableCard } from './table-card';
import type { SeatingHost } from './use-seating-host';

interface TableListProps {
  tables: readonly SeatingTable[];
  host: SeatingHost;
  timeZone: string;
  venueRoom: number | null;
}

/** The plan's tables in their natural order, and the ways to add them (design PD-68). */
export function TableList({ tables, host, timeZone, venueRoom }: TableListProps) {
  const { t } = useTranslation('seating');
  return (
    <section aria-labelledby="seating-tables" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="seating-tables" className="m-0 text-lg font-medium">
          {t('tables.title')}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            className={WRAP}
            onClick={(event) => host.open({ kind: 'addTable' }, event.currentTarget)}
          >
            {t('tables.add')}
          </Button>
          <Button
            variant="outline"
            className={WRAP}
            onClick={(event) => host.open({ kind: 'addTables' }, event.currentTarget)}
          >
            {t('tables.addSeveral')}
          </Button>
        </div>
      </div>
      {tables.length === 0 ? (
        <p className="text-muted-foreground m-0">{t('tables.empty')}</p>
      ) : null}
      {tables.map((table) => (
        <TableCard
          key={table.id}
          table={table}
          host={host}
          timeZone={timeZone}
          venueRoom={venueRoom}
        />
      ))}
    </section>
  );
}
