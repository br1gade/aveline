import { ExportKind } from '@prisma/client';
import { CsvRow } from '../csv';
import { Sheet } from '../export-sheets';
import { EXPORT_TITLES } from './export-document';

const TRANSLATIONS = {
  'Guest list': ['Список гостей', 'Liste des invités', 'Հյուրերի ցանկ'],
  'Seating chart': ['План рассадки', 'Plan de table', 'Նստեցման պլան'],
  'Place cards': ['Карточки гостей', 'Marque-places', 'Անվանական քարտեր'],
  'Catering sheet': ['Питание', 'Restauration', 'Սննդի ցանկ'],
  'Bar sheet': ['Напитки', 'Boissons', 'Խմիչքների ցանկ'],
  Playlist: ['Плейлист', 'Liste musicale', 'Երգացանկ'],
  'Ticket manifest': ['Список билетов', 'Liste des billets', 'Տոմսերի ցանկ'],
  Household: ['Семья / группа', 'Foyer / groupe', 'Ընտանիք / խումբ'],
  'First name': ['Имя', 'Prénom', 'Անուն'], 'Last name': ['Фамилия', 'Nom de famille', 'Ազգանուն'],
  Email: ['Эл. почта', 'E-mail', 'Էլ. փոստ'], Phone: ['Телефон', 'Téléphone', 'Հեռախոս'],
  Side: ['Сторона', 'Côté', 'Կողմ'], 'Seats allotted': ['Выделено мест', 'Places attribuées', 'Հատկացված տեղեր'],
  RSVP: ['Ответ', 'Réponse', 'Մասնակցության պատասխան'], Dietary: ['Особенности питания', 'Régime alimentaire', 'Սննդային պահանջներ'],
  'Dietary notes': ['Примечания по питанию', 'Notes alimentaires', 'Նշումներ սննդի մասին'],
  Drink: ['Напиток', 'Boisson', 'Խմիչք'], Table: ['Стол', 'Table', 'Սեղան'],
  'Seating by venue': ['Рассадка по площадкам', 'Places par lieu', 'Նստեցում ըստ վայրի'],
  Arrived: ['Прибытие', 'Arrivée', 'Ժամանում'], Venue: ['Площадка', 'Lieu', 'Վայր'],
  Arrangement: ['Схема рассадки', 'Disposition', 'Նստեցման սխեմա'], Capacity: ['Вместимость', 'Capacité', 'Տարողություն'],
  Seated: ['Рассажено', 'Personnes placées', 'Նստեցվածներ'], Guest: ['Гость', 'Invité', 'Հյուր'],
  Name: ['Имя', 'Nom', 'Անուն'], Requirement: ['Требование', 'Besoin', 'Պահանջ'],
  Guests: ['Гости', 'Invités', 'Հյուրեր'], Note: ['Примечание', 'Note', 'Նշում'],
  'Share %': ['Доля %', 'Part %', 'Բաժին %'], Track: ['Композиция', 'Titre musical', 'Երգ'],
  Requests: ['Запросы', 'Demandes', 'Հարցումներ'], Code: ['Код', 'Code', 'Կոդ'],
  Type: ['Тип', 'Type', 'Տեսակ'], Holder: ['Владелец', 'Titulaire', 'Տոմսատեր'],
  Buyer: ['Покупатель', 'Acheteur', 'Գնորդ'], 'Buyer email': ['Почта покупателя', 'E-mail de l’acheteur', 'Գնորդի էլ. փոստ'],
  Status: ['Статус', 'Statut', 'Կարգավիճակ'], 'Used at': ['Время использования', 'Utilisé le', 'Օգտագործման ժամ'],
  'Guest and household': ['Гость и семья / группа', 'Invité et foyer / groupe', 'Հյուր և ընտանիք / խումբ'],
  Requirements: ['Требования', 'Besoins', 'Պահանջներ'],
  Generated: ['Создано', 'Généré le', 'Ստեղծվել է'], 'Generated (UTC)': ['Создано (UTC)', 'Généré le (UTC)', 'Ստեղծվել է (UTC)'],
  'Event timezone': ['Часовой пояс события', 'Fuseau horaire de l’événement', 'Միջոցառման ժամային գոտի'],
  'Includes contact details': ['Содержит контактные данные', 'Coordonnées incluses', 'Ներառում է կոնտակտային տվյալներ'],
  'Contact columns omitted': ['Контактные данные исключены', 'Colonnes de coordonnées exclues', 'Կոնտակտային սյունակները բաց են թողնված'],
  Page: ['Страница', 'Page', 'Էջ'], 'No records': ['Нет записей', 'Aucune donnée', 'Տվյալներ չկան'],
  'Column group': ['Группа столбцов', 'Groupe de colonnes', 'Սյունակների խումբ'], of: ['из', 'sur', '/'],
  Unspecified: ['Не указано', 'Non précisé', 'Նշված չէ'],
  'Total covers': ['Всего порций', 'Nombre total de couverts', 'Սննդի բաժինների ընդհանուր քանակ'],
  'Dietary note': ['Примечание по питанию', 'Note alimentaire', 'Նշում սննդի մասին'],
  'No responses': ['Нет ответов', 'Aucune réponse', 'Պատասխաններ չկան'],
  ATTENDING: ['Придёт', 'Présent', 'Մասնակցելու է'], DECLINED: ['Не придёт', 'Absent', 'Չի մասնակցելու'],
  PENDING: ['Ожидается ответ', 'En attente', 'Սպասման մեջ'], UNDECIDED: ['Не решил(а)', 'Indécis', 'Չի կողմնորոշվել'],
  VALID: ['Действителен', 'Valide', 'Վավեր'], USED: ['Использован', 'Utilisé', 'Օգտագործված'],
  VOID: ['Аннулирован', 'Annulé', 'Չեղարկված'], REFUNDED: ['Возврат', 'Remboursé', 'Վերադարձված'],
  SIDE_A: ['Сторона A', 'Côté A', 'Կողմ A'], SIDE_B: ['Сторона B', 'Côté B', 'Կողմ B'],
  SHARED: ['Общие', 'Commun', 'Ընդհանուր'], UNKNOWN: ['Не указано', 'Non précisé', 'Նշված չէ'],
} satisfies Record<string, readonly [string, string, string]>;

export function exportText(locale: string, text: string): string {
  const index = ['ru', 'fr', 'hy'].indexOf(locale.toLowerCase().split('-')[0]);
  const translations = TRANSLATIONS[text as keyof typeof TRANSLATIONS];
  return index >= 0 && translations ? translations[index] : text;
}

export function exportTitle(locale: string, kind: ExportKind): string { return exportText(locale, EXPORT_TITLES[kind]); }

/** Host-authored names, answers and notes remain literal, even when they match an enum. */
export function exportValue(locale: string, column: string, value: CsvRow[string]): CsvRow[string] {
  if (typeof value !== 'string') return value;
  if (['RSVP', 'Status', 'Side'].includes(column)) return exportText(locale, value);
  if (column === 'Requirement' && ['Total covers', 'Dietary note'].includes(value)) return exportText(locale, value);
  if (column === 'Drink' && value === 'No responses') return exportText(locale, value);
  if (column === 'Venue' && value === 'Unspecified') return exportText(locale, value);
  return value;
}

export function translateSheet(sheet: Sheet, locale: string): Sheet {
  return { columns: sheet.columns.map((column) => exportText(locale, column)),
    rows: sheet.rows.map((row) => Object.fromEntries(sheet.columns.map((column) => [exportText(locale, column), exportValue(locale, column, row[column])]))),
  };
}
