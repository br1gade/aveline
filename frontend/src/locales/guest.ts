import enCommon from './en/common.json';
import enGallery from './en/gallery.json';
import enGuestAgreements from './en/guest-agreements.json';
import enInvitation from './en/invitation.json';
import enReply from './en/reply.json';
import frCommon from './fr/common.json';
import frGallery from './fr/gallery.json';
import frGuestAgreements from './fr/guest-agreements.json';
import frInvitation from './fr/invitation.json';
import frReply from './fr/reply.json';
import hyCommon from './hy/common.json';
import hyGallery from './hy/gallery.json';
import hyGuestAgreements from './hy/guest-agreements.json';
import hyInvitation from './hy/invitation.json';
import hyReply from './hy/reply.json';
import ruCommon from './ru/common.json';
import ruGallery from './ru/gallery.json';
import ruGuestAgreements from './ru/guest-agreements.json';
import ruInvitation from './ru/invitation.json';
import ruReply from './ru/reply.json';

import { addStrings } from './registry';

/** What a guest's own pages need: always loaded, as every page's words start from these. */
addStrings({
  en: {
    common: enCommon,
    gallery: enGallery,
    'guest-agreements': enGuestAgreements,
    invitation: enInvitation,
    reply: enReply,
  },
  fr: {
    common: frCommon,
    gallery: frGallery,
    'guest-agreements': frGuestAgreements,
    invitation: frInvitation,
    reply: frReply,
  },
  hy: {
    common: hyCommon,
    gallery: hyGallery,
    'guest-agreements': hyGuestAgreements,
    invitation: hyInvitation,
    reply: hyReply,
  },
  ru: {
    common: ruCommon,
    gallery: ruGallery,
    'guest-agreements': ruGuestAgreements,
    invitation: ruInvitation,
    reply: ruReply,
  },
});
