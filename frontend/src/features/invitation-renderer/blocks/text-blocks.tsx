import { useTranslation } from 'react-i18next';

import { ButtonLink, cx, EXTERNAL_LINK, Icon, SectionHeading } from '@/ui';

import { ArchFrame } from '../components/arch-frame';
import { imageSource } from '../components/image-source';
import { Section, variantOf } from '../components/section';
import {
  bodyContent,
  chatContent,
  contactContent,
  notesContent,
  paragraphs,
  photos,
  safeExternalUrl,
  signatureContent,
  telephoneHref,
} from '../schemas';
import type { BlockProps } from './block-props';

/** `letter`: a centred column, the first paragraph larger. `with-photo` adds the photograph. */
export function StoryBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const { title, body } = bodyContent(block);
  const parts = paragraphs(body);
  if (parts.length === 0) return null;
  const photo =
    variantOf(block.variant, ['letter', 'with-photo']) === 'with-photo'
      ? photos(block)[0]
      : undefined;
  return (
    <Section
      columnClassName={cx(
        'items-center gap-4 text-center',
        photo && 'lg:grid lg:grid-cols-[2fr_3fr] lg:items-center lg:text-left',
      )}
    >
      {photo ? (
        <img
          {...imageSource(photo)}
          alt={photo.altText ?? ''}
          loading="lazy"
          decoding="async"
          sizes="(min-width: 1024px) 16rem, 90vw"
          className="bg-sand aspect-[4/5] w-full object-cover lg:row-span-2 lg:aspect-[3/4]"
        />
      ) : null}
      <SectionHeading label={t('story.label')} heading={title} isCentred={!photo} />
      <div className="flex max-w-[34em] flex-col gap-4 text-pretty">
        {parts.map((part, index) => (
          <p key={index} className={cx('m-0 whitespace-pre-line', index === 0 && 'type-lead')}>
            {part}
          </p>
        ))}
      </div>
    </Section>
  );
}

/** The host's requests: `list` with hairlines between, or `cards`. */
export function NotesBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const { title, items } = notesContent(block);
  if (items.length === 0) return null;
  const isCards = variantOf(block.variant, ['list', 'cards']) === 'cards';
  return (
    <Section>
      <SectionHeading label={t('notes.label')} heading={title ?? t('notes.heading')} />
      <ul
        className={cx(
          'm-0 flex list-none flex-col p-0',
          isCards ? 'gap-4' : 'divide-hairline divide-y',
        )}
      >
        {items.map((item, index) => (
          <li
            key={index}
            className={cx(
              'flex flex-col gap-1',
              isCards
                ? 'border-hairline bg-surface-raised border p-6'
                : 'py-4 first:pt-0 last:pb-0',
            )}
          >
            {item.title ? (
              <h3 className="m-0 text-base leading-6 font-semibold">{item.title}</h3>
            ) : null}
            {item.body ? <p className="m-0 whitespace-pre-line">{item.body}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** A closing line and the hosts' signature: an image at most 240 px wide, or a photograph in the arch. */
export function SignatureBlock({ block }: BlockProps) {
  const { closing } = signatureContent(block);
  const image = block.media.find((media) => media.kind === 'SIGNATURE' || media.kind === 'LOGO');
  const photo = image ? undefined : photos(block)[0];
  if (!closing && !image && !photo) return null;
  return (
    <Section columnClassName="items-center gap-4 text-center">
      {closing ? <p className="type-heading-2 text-heading m-0">{closing}</p> : null}
      {image ? (
        <img
          {...imageSource(image)}
          alt={image.altText ?? ''}
          sizes="240px"
          loading="lazy"
          decoding="async"
          className="h-auto w-full max-w-[240px]"
        />
      ) : null}
      {photo ? <ArchFrame photo={photo} sizes="240px" className="w-full max-w-[240px]" /> : null}
    </Section>
  );
}

/** The guests' group chat. Nothing without a link the page may open. */
export function ChatBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const { title, body, url, label } = chatContent(block);
  const href = safeExternalUrl(url);
  if (!href) return null;
  return (
    <Section columnClassName="gap-4">
      <SectionHeading label={t('chat.label')} heading={title} />
      {body ? <p className="m-0 whitespace-pre-line">{body}</p> : null}
      <ButtonLink href={href} variant="secondary" className="self-start" {...EXTERNAL_LINK}>
        <Icon name="message-circle" />
        {label ?? t('chat.join')}
      </ButtonLink>
    </Section>
  );
}

/** The organiser and a number to call. The number is text first: `tel:` may do nothing on desktop. */
export function ContactBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const { title, organizer, phone } = contactContent(block);
  if (!organizer && !phone) return null;
  const href = phone ? telephoneHref(phone) : undefined;
  return (
    <Section columnClassName="gap-2">
      <SectionHeading label={title ?? t('contact.label')} />
      {organizer ? <p className="type-heading-2 text-heading m-0">{organizer}</p> : null}
      {phone ? <p className="m-0 select-text">{phone}</p> : null}
      {href ? (
        <ButtonLink href={href} variant="secondary" className="mt-2 self-start">
          <Icon name="phone" />
          {t('contact.call')}
        </ButtonLink>
      ) : null}
    </Section>
  );
}
