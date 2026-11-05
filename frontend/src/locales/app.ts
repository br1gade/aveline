import enAccount from './en/account.json';
import enActivity from './en/activity.json';
import enAgreements from './en/agreements.json';
import enApp from './en/app.json';
import enBilling from './en/billing.json';
import enCustomers from './en/customers.json';
import enDataRequests from './en/data-requests.json';
import enDesign from './en/design.json';
import enDoor from './en/door.json';
import enEvents from './en/events.json';
import enExports from './en/exports.json';
import enFollowUps from './en/follow-ups.json';
import enGuests from './en/guests.json';
import enOrganization from './en/organization.json';
import enPromoCodes from './en/promo-codes.json';
import enRecordedAnswer from './en/recorded-answer.json';
import enRunningOrder from './en/running-order.json';
import enSeating from './en/seating.json';
import enSending from './en/sending.json';
import enSheets from './en/sheets.json';
import enSuppressions from './en/suppressions.json';
import enTeam from './en/team.json';
import enTicketOrders from './en/ticket-orders.json';
import enTicketSales from './en/ticket-sales.json';
import enVendors from './en/vendors.json';
import enVenues from './en/venues.json';
import frAccount from './fr/account.json';
import frActivity from './fr/activity.json';
import frAgreements from './fr/agreements.json';
import frApp from './fr/app.json';
import frBilling from './fr/billing.json';
import frCustomers from './fr/customers.json';
import frDataRequests from './fr/data-requests.json';
import frDesign from './fr/design.json';
import frDoor from './fr/door.json';
import frEvents from './fr/events.json';
import frExports from './fr/exports.json';
import frFollowUps from './fr/follow-ups.json';
import frGuests from './fr/guests.json';
import frOrganization from './fr/organization.json';
import frPromoCodes from './fr/promo-codes.json';
import frRecordedAnswer from './fr/recorded-answer.json';
import frRunningOrder from './fr/running-order.json';
import frSeating from './fr/seating.json';
import frSending from './fr/sending.json';
import frSheets from './fr/sheets.json';
import frSuppressions from './fr/suppressions.json';
import frTeam from './fr/team.json';
import frTicketOrders from './fr/ticket-orders.json';
import frTicketSales from './fr/ticket-sales.json';
import frVendors from './fr/vendors.json';
import frVenues from './fr/venues.json';
import hyAccount from './hy/account.json';
import hyActivity from './hy/activity.json';
import hyAgreements from './hy/agreements.json';
import hyApp from './hy/app.json';
import hyBilling from './hy/billing.json';
import hyCustomers from './hy/customers.json';
import hyDataRequests from './hy/data-requests.json';
import hyDesign from './hy/design.json';
import hyDoor from './hy/door.json';
import hyEvents from './hy/events.json';
import hyExports from './hy/exports.json';
import hyFollowUps from './hy/follow-ups.json';
import hyGuests from './hy/guests.json';
import hyOrganization from './hy/organization.json';
import hyPromoCodes from './hy/promo-codes.json';
import hyRecordedAnswer from './hy/recorded-answer.json';
import hyRunningOrder from './hy/running-order.json';
import hySeating from './hy/seating.json';
import hySending from './hy/sending.json';
import hySheets from './hy/sheets.json';
import hySuppressions from './hy/suppressions.json';
import hyTeam from './hy/team.json';
import hyTicketOrders from './hy/ticket-orders.json';
import hyTicketSales from './hy/ticket-sales.json';
import hyVendors from './hy/vendors.json';
import hyVenues from './hy/venues.json';
import ruAccount from './ru/account.json';
import ruActivity from './ru/activity.json';
import ruAgreements from './ru/agreements.json';
import ruApp from './ru/app.json';
import ruBilling from './ru/billing.json';
import ruCustomers from './ru/customers.json';
import ruDataRequests from './ru/data-requests.json';
import ruDesign from './ru/design.json';
import ruDoor from './ru/door.json';
import ruEvents from './ru/events.json';
import ruExports from './ru/exports.json';
import ruFollowUps from './ru/follow-ups.json';
import ruGuests from './ru/guests.json';
import ruOrganization from './ru/organization.json';
import ruPromoCodes from './ru/promo-codes.json';
import ruRecordedAnswer from './ru/recorded-answer.json';
import ruRunningOrder from './ru/running-order.json';
import ruSeating from './ru/seating.json';
import ruSending from './ru/sending.json';
import ruSheets from './ru/sheets.json';
import ruSuppressions from './ru/suppressions.json';
import ruTeam from './ru/team.json';
import ruTicketOrders from './ru/ticket-orders.json';
import ruTicketSales from './ru/ticket-sales.json';
import ruVendors from './ru/vendors.json';
import ruVenues from './ru/venues.json';

import { addStrings } from './registry';

/** The account pages and the organizer app. Imported by their routes alone, so no guest loads them. */
addStrings({
  en: {
    account: enAccount,
    activity: enActivity,
    agreements: enAgreements,
    app: enApp,
    billing: enBilling,
    customers: enCustomers,
    'data-requests': enDataRequests,
    design: enDesign,
    door: enDoor,
    events: enEvents,
    exports: enExports,
    'follow-ups': enFollowUps,
    guests: enGuests,
    organization: enOrganization,
    'promo-codes': enPromoCodes,
    'recorded-answer': enRecordedAnswer,
    'running-order': enRunningOrder,
    seating: enSeating,
    sending: enSending,
    sheets: enSheets,
    suppressions: enSuppressions,
    team: enTeam,
    'ticket-orders': enTicketOrders,
    'ticket-sales': enTicketSales,
    vendors: enVendors,
    venues: enVenues,
  },
  fr: {
    account: frAccount,
    activity: frActivity,
    agreements: frAgreements,
    app: frApp,
    billing: frBilling,
    customers: frCustomers,
    'data-requests': frDataRequests,
    design: frDesign,
    door: frDoor,
    events: frEvents,
    exports: frExports,
    'follow-ups': frFollowUps,
    guests: frGuests,
    organization: frOrganization,
    'promo-codes': frPromoCodes,
    'recorded-answer': frRecordedAnswer,
    'running-order': frRunningOrder,
    seating: frSeating,
    sending: frSending,
    sheets: frSheets,
    suppressions: frSuppressions,
    team: frTeam,
    'ticket-orders': frTicketOrders,
    'ticket-sales': frTicketSales,
    vendors: frVendors,
    venues: frVenues,
  },
  hy: {
    account: hyAccount,
    activity: hyActivity,
    agreements: hyAgreements,
    app: hyApp,
    billing: hyBilling,
    customers: hyCustomers,
    'data-requests': hyDataRequests,
    design: hyDesign,
    door: hyDoor,
    events: hyEvents,
    exports: hyExports,
    'follow-ups': hyFollowUps,
    guests: hyGuests,
    organization: hyOrganization,
    'promo-codes': hyPromoCodes,
    'recorded-answer': hyRecordedAnswer,
    'running-order': hyRunningOrder,
    seating: hySeating,
    sending: hySending,
    sheets: hySheets,
    suppressions: hySuppressions,
    team: hyTeam,
    'ticket-orders': hyTicketOrders,
    'ticket-sales': hyTicketSales,
    vendors: hyVendors,
    venues: hyVenues,
  },
  ru: {
    account: ruAccount,
    activity: ruActivity,
    agreements: ruAgreements,
    app: ruApp,
    billing: ruBilling,
    customers: ruCustomers,
    'data-requests': ruDataRequests,
    design: ruDesign,
    door: ruDoor,
    events: ruEvents,
    exports: ruExports,
    'follow-ups': ruFollowUps,
    guests: ruGuests,
    organization: ruOrganization,
    'promo-codes': ruPromoCodes,
    'recorded-answer': ruRecordedAnswer,
    'running-order': ruRunningOrder,
    seating: ruSeating,
    sending: ruSending,
    sheets: ruSheets,
    suppressions: ruSuppressions,
    team: ruTeam,
    'ticket-orders': ruTicketOrders,
    'ticket-sales': ruTicketSales,
    vendors: ruVendors,
    venues: ruVenues,
  },
});
