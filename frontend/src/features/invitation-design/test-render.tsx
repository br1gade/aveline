import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, type LoaderFunctionArgs } from 'react-router';

import type { BrowserSession } from '@/api/session';
import { createI18n, type Language } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import { DesignLook } from './components/design-look';
import { DesignMedia } from './components/design-media';
import { DesignOverview } from './components/design-overview';
import { DesignPreview } from './components/design-preview';
import { DesignQuestions } from './components/design-questions';
import { DesignSection } from './components/design-section';
import { EditDesignQuestion, NewDesignQuestion } from './components/question-pages';
import {
  loadDesignLook,
  loadDesignMedia,
  loadDesignOverview,
  loadDesignPreview,
  loadDesignQuestion,
  loadDesignQuestions,
  loadDesignSection,
  previewRequestOf,
  type DesignData,
  type DesignLookData,
  type DesignMediaData,
  type DesignPreviewData,
  type DesignQuestionData,
  type DesignSectionData,
} from './load';

type LoaderArgs = LoaderFunctionArgs;

type Api = () => BrowserSession['api'];

const id = (value: string | undefined) => value ?? '';

/** The overview, the look and a section, as the app routes them. */
function sectionRoutes(api: Api) {
  return [
    {
      path: APP_PATHS.design,
      loader: ({ params }: LoaderArgs) => loadDesignOverview(api(), id(params.eventId)),
      Component: () => <DesignOverview data={useLoaderData<DesignData>()} />,
    },
    {
      path: APP_PATHS.designLook,
      loader: ({ params }: LoaderArgs) => loadDesignLook(api(), id(params.eventId)),
      Component: () => <DesignLook data={useLoaderData<DesignLookData>()} />,
    },
    {
      path: APP_PATHS.designSection,
      loader: ({ params }: LoaderArgs) =>
        loadDesignSection(api(), id(params.eventId), id(params.blockType)),
      Component: () => <DesignSection data={useLoaderData<DesignSectionData>()} />,
    },
  ];
}

/** The questions, the media and the preview. */
function otherRoutes(api: Api) {
  return [
    {
      path: APP_PATHS.designQuestions,
      loader: ({ params }: LoaderArgs) => loadDesignQuestions(api(), id(params.eventId)),
      Component: () => <DesignQuestions data={useLoaderData<DesignData>()} />,
    },
    {
      path: APP_PATHS.newDesignQuestion,
      loader: ({ params }: LoaderArgs) => loadDesignQuestions(api(), id(params.eventId)),
      Component: () => <NewDesignQuestion data={useLoaderData<DesignData>()} />,
    },
    {
      path: APP_PATHS.editDesignQuestion,
      loader: ({ params }: LoaderArgs) =>
        loadDesignQuestion(api(), id(params.eventId), id(params.questionId)),
      Component: () => <EditDesignQuestion data={useLoaderData<DesignQuestionData>()} />,
    },
    {
      path: APP_PATHS.designMedia,
      loader: ({ params }: LoaderArgs) => loadDesignMedia(api(), id(params.eventId)),
      Component: () => <DesignMedia data={useLoaderData<DesignMediaData>()} />,
    },
    {
      path: APP_PATHS.designPreview,
      loader: ({ params, request }: LoaderArgs) =>
        loadDesignPreview(api(), id(params.eventId), previewRequestOf(new URL(request.url))),
      Component: () => <DesignPreview data={useLoaderData<DesignPreviewData>()} />,
    },
  ];
}

/** Pages the design links to, as stand-ins. */
const ELSEWHERE = [
  { path: APP_PATHS.event, Component: () => <p>Event page</p> },
  { path: APP_PATHS.venues, Component: () => <p>Venues page</p> },
  { path: APP_PATHS.newVenue, Component: () => <p>New venue page</p> },
  { path: APP_PATHS.editEvent, Component: () => <p>Edit event page</p> },
];

/** Every design page, routed as the app routes them, against the test's session. */
export function renderDesign(
  session: () => BrowserSession,
  path: string,
  language: Language = 'en',
) {
  const api = () => session().api;
  const Stub = createRoutesStub([...sectionRoutes(api), ...otherRoutes(api), ...ELSEWHERE]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}
