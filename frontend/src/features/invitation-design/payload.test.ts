import { describe, expect, it } from 'vitest';

import { BLOCK_EDITING } from '@/features/invitation-renderer';

import {
  questionFormValues,
  rsvpFieldsFormValues,
  sectionFormValues,
  type QuestionValues,
} from './form-model';
import {
  addSectionArrangement,
  altTextEdit,
  choiceLists,
  moveQuestionOrder,
  moveSectionArrangement,
  questionCreate,
  questionEdit,
  rsvpFieldsEdit,
  sectionEdit,
  themeEdit,
} from './payload';
import { readRsvpFields } from './read';
import type { DesignBlock, Question, TemplateSummary } from './types';

const LOCALES = ['hy', 'en'];

function section(type: string, fields: Partial<DesignBlock> = {}): DesignBlock {
  return {
    type,
    enabled: true,
    variant: null,
    content: {},
    settings: {},
    assetIds: [],
    media: [],
    ...fields,
  };
}

const HERO = section('HERO', {
  content: {
    hy: { title: 'Աննա և Դավիթ', kicker: 'kept' },
    en: { title: 'Anna & Davit', subtitle: 'invite you' },
    fr: { title: 'Anna et Davit' },
  },
});

describe('sectionEdit', () => {
  it('sends only the language edited, over its stored copy, so unknown fields survive', () => {
    const baseline = sectionFormValues(HERO, BLOCK_EDITING.HERO, LOCALES);
    const values = structuredClone(baseline);
    values.copy.hy!.fields.subtitle = '  հրավիրում են  ';

    expect(sectionEdit(HERO, BLOCK_EDITING.HERO, baseline, values)).toEqual({
      content: { hy: { title: 'Աննա և Դավիթ', kicker: 'kept', subtitle: 'հրավիրում են' } },
    });
  });

  it('drops a cleared field, and removes a language left empty so guests fall back', () => {
    const baseline = sectionFormValues(HERO, BLOCK_EDITING.HERO, LOCALES);
    const values = structuredClone(baseline);
    values.copy.en!.fields.subtitle = ' ';
    const cleared = sectionEdit(HERO, BLOCK_EDITING.HERO, baseline, values);
    expect(cleared).toEqual({ content: { en: { title: 'Anna & Davit' } } });

    values.copy.en!.fields.title = '';
    expect(sectionEdit(HERO, BLOCK_EDITING.HERO, baseline, values)).toEqual({
      content: { en: null },
    });
  });

  it('keeps a language whose only field is one the form does not show', () => {
    const baseline = sectionFormValues(HERO, BLOCK_EDITING.HERO, LOCALES);
    const values = structuredClone(baseline);
    values.copy.hy!.fields.title = '';
    expect(sectionEdit(HERO, BLOCK_EDITING.HERO, baseline, values)).toEqual({
      content: { hy: { kicker: 'kept' } },
    });
  });

  it('never sends a language the event no longer publishes, nor one never written', () => {
    const baseline = sectionFormValues(HERO, BLOCK_EDITING.HERO, [...LOCALES, 'ru']);
    expect(Object.keys(baseline.copy)).toEqual(['hy', 'en', 'ru']);
    expect(sectionEdit(HERO, BLOCK_EDITING.HERO, baseline, structuredClone(baseline))).toEqual({});
  });

  it('writes a note per item, leaving out empty ones, and removes the list once empty', () => {
    const notes = section('NOTES', {
      content: { en: { title: 'Requests', items: [{ title: 'Flowers', body: 'None, please' }] } },
    });
    const baseline = sectionFormValues(notes, BLOCK_EDITING.NOTES, ['en']);
    expect(baseline.copy.en!.items).toEqual([{ title: 'Flowers', body: 'None, please' }]);

    const values = structuredClone(baseline);
    values.copy.en!.items.push({ title: '', body: '' }, { title: 'Children', body: '' });
    expect(sectionEdit(notes, BLOCK_EDITING.NOTES, baseline, values)).toEqual({
      content: {
        en: {
          title: 'Requests',
          items: [{ title: 'Flowers', body: 'None, please' }, { title: 'Children' }],
        },
      },
    });

    values.copy.en!.items = [];
    expect(sectionEdit(notes, BLOCK_EDITING.NOTES, baseline, values)).toEqual({
      content: { en: { title: 'Requests' } },
    });
  });

  it('replaces the swatches over the stored settings, in lowercase, and removes them once empty', () => {
    const dress = section('DRESS_CODE', {
      settings: { palette: ['#2E2A26'], other: true },
    });
    const baseline = sectionFormValues(dress, BLOCK_EDITING.DRESS_CODE, LOCALES);
    expect(baseline.colours).toEqual(['#2e2a26']);

    const values = { ...structuredClone(baseline), colours: ['#2e2a26', '#C9A227'] };
    expect(sectionEdit(dress, BLOCK_EDITING.DRESS_CODE, baseline, values)).toEqual({
      settings: { palette: ['#2e2a26', '#c9a227'], other: true },
    });
    values.colours = [];
    expect(sectionEdit(dress, BLOCK_EDITING.DRESS_CODE, baseline, values)).toEqual({
      settings: { other: true },
    });
  });

  it('sends the layout, null for the template’s default, and the media in their order', () => {
    const gallery = section('GALLERY', { variant: 'grid', assetIds: ['a', 'b'] });
    const baseline = sectionFormValues(gallery, BLOCK_EDITING.GALLERY, LOCALES);
    const values = { ...structuredClone(baseline), variant: '', assetIds: ['b', 'a', 'c'] };
    expect(sectionEdit(gallery, BLOCK_EDITING.GALLERY, baseline, values)).toEqual({
      variant: null,
      assetIds: ['b', 'a', 'c'],
    });
  });
});

describe('themeEdit', () => {
  it('sends only what changed, and never a choice left empty', () => {
    const baseline = { headingFont: '', bodyFont: 'Inter', palette: 'paper' };
    expect(themeEdit(baseline, { ...baseline })).toEqual({});
    expect(themeEdit(baseline, { headingFont: '', bodyFont: 'Mardoto', palette: 'ink' })).toEqual({
      bodyFont: 'Mardoto',
      palette: 'ink',
    });
  });
});

describe('rsvpFieldsEdit', () => {
  const config = readRsvpFields({
    drinkPreference: {
      isEnabled: true,
      options: [{ key: 'wine', label: { en: 'Wine', ru: 'Вино' } }],
    },
  });

  it('sends only the questions changed', () => {
    const baseline = rsvpFieldsFormValues(config, LOCALES);
    const values = structuredClone(baseline);
    values.songRequest.isEnabled = false;
    expect(rsvpFieldsEdit(config, baseline, values, LOCALES)).toEqual({
      songRequest: { isEnabled: false },
    });
  });

  it('keeps saved keys and labels in languages not on the form, and makes keys for new choices', () => {
    const baseline = rsvpFieldsFormValues(config, LOCALES);
    const values = structuredClone(baseline);
    values.drinkPreference.choices[0]!.labels.hy = 'Գինի';
    values.drinkPreference.choices.push(
      { key: '', labels: { hy: '', en: 'Red wine' } },
      { key: '', labels: { hy: 'Օղի', en: '' } },
    );
    expect(rsvpFieldsEdit(config, baseline, values, LOCALES)).toEqual({
      drinkPreference: {
        isEnabled: true,
        options: [
          { key: 'wine', label: { ru: 'Вино', hy: 'Գինի', en: 'Wine' } },
          { key: 'red-wine', label: { en: 'Red wine' } },
          { key: 'choice-3', label: { hy: 'Օղի' } },
        ],
      },
    });
  });

  it('returns a question to free text', () => {
    const baseline = rsvpFieldsFormValues(config, LOCALES);
    const values = structuredClone(baseline);
    values.drinkPreference.hasChoices = false;
    expect(rsvpFieldsEdit(config, baseline, values, LOCALES)).toEqual({
      drinkPreference: { isEnabled: true, options: null },
    });
  });
});

const ANSWERED: Question = {
  id: 'q1',
  type: 'SINGLE_CHOICE',
  required: true,
  prompt: { hy: 'Ինչպե՞ս', en: 'How?', fr: 'Comment ?' },
  options: { hy: ['Մեքենա', 'Տրանսֆեր'], en: ['Car', 'Shuttle'] },
  answerCount: 4,
};

describe('choiceLists', () => {
  it('lists each language filled in full, leaves out an empty one, and names a half-filled one', () => {
    const result = choiceLists(
      [
        { hy: 'Ա', en: 'A', ru: '' },
        { hy: 'Բ', en: '', ru: '' },
      ],
      ['hy', 'en', 'ru'],
    );
    expect(result).toEqual({ lists: { hy: ['Ա', 'Բ'] }, halfFilled: ['en'], empty: ['ru'] });
  });
});

describe('questionCreate', () => {
  it('sends the prompt in the languages given and the choices of a choice question', () => {
    const values: QuestionValues = {
      type: 'MULTI_CHOICE',
      required: false,
      prompt: { hy: '', en: ' Meal? ' },
      choices: [
        { hy: '', en: 'Fish' },
        { hy: '', en: 'Meat' },
      ],
    };
    expect(questionCreate(values, LOCALES)).toEqual({
      type: 'MULTI_CHOICE',
      required: false,
      prompt: { en: 'Meal?' },
      options: { en: ['Fish', 'Meat'] },
    });
  });

  it('sends no choices for a question that takes none', () => {
    const values: QuestionValues = {
      type: 'TEXT',
      required: true,
      prompt: { hy: 'Ինչ', en: '' },
      choices: [{ hy: 'x', en: '' }],
    };
    expect(questionCreate(values, LOCALES)).toEqual({
      type: 'TEXT',
      required: true,
      prompt: { hy: 'Ինչ' },
    });
  });
});

describe('questionEdit', () => {
  it('sends only what changed, one language at a time, null for a language emptied', () => {
    const baseline = questionFormValues(ANSWERED, LOCALES);
    const values = structuredClone(baseline);
    values.prompt.en = 'How will you arrive?';
    values.choices.push({ hy: 'Ոտքով', en: 'On foot' });
    expect(questionEdit(ANSWERED, baseline, values, LOCALES)).toEqual({
      prompt: { en: 'How will you arrive?' },
      options: { hy: ['Մեքենա', 'Տրանսֆեր', 'Ոտքով'], en: ['Car', 'Shuttle', 'On foot'] },
    });

    const emptied = structuredClone(baseline);
    emptied.prompt.hy = '';
    emptied.choices = emptied.choices.map((choice) => ({ ...choice, en: '' }));
    expect(questionEdit(ANSWERED, baseline, emptied, LOCALES)).toEqual({
      prompt: { hy: null },
      options: { en: null },
    });
  });

  it('sends nothing when nothing changed, and the type and requirement when they did', () => {
    const baseline = questionFormValues(ANSWERED, LOCALES);
    expect(questionEdit(ANSWERED, baseline, structuredClone(baseline), LOCALES)).toEqual({});
    expect(
      questionEdit(
        ANSWERED,
        baseline,
        { ...baseline, type: 'MULTI_CHOICE', required: false },
        LOCALES,
      ),
    ).toEqual({ type: 'MULTI_CHOICE', required: false });
  });
});

const TEMPLATE: TemplateSummary = {
  key: 'minimal',
  name: 'Minimal',
  allowedFonts: [],
  palettes: [],
  supportedBlocks: ['HERO', 'VENUE', 'RSVP', 'CONTACT'],
};

const BLOCKS = [
  section('HERO'),
  section('STORY', { enabled: false }),
  section('VENUE'),
  section('FIREWORKS'),
  section('RSVP', { enabled: false }),
];

describe('moveSectionArrangement', () => {
  it('swaps a section with the one before it that can move, leaving out what cannot be sent', () => {
    expect(moveSectionArrangement(BLOCKS, TEMPLATE, 'RSVP', -1)).toEqual({
      blocks: [{ type: 'HERO' }, { type: 'RSVP' }, { type: 'VENUE' }],
    });
    expect(moveSectionArrangement(BLOCKS, TEMPLATE, 'HERO', 1)).toEqual({
      blocks: [{ type: 'VENUE' }, { type: 'HERO' }, { type: 'RSVP' }],
    });
  });

  it('cannot move the first section up, the last down, or a section that cannot be sent', () => {
    expect(moveSectionArrangement(BLOCKS, TEMPLATE, 'HERO', -1)).toBeNull();
    expect(moveSectionArrangement(BLOCKS, TEMPLATE, 'RSVP', 1)).toBeNull();
    expect(moveSectionArrangement(BLOCKS, TEMPLATE, 'STORY', 1)).toBeNull();
  });

  it('moves anything known when the template declares no restriction', () => {
    const open = { ...TEMPLATE, supportedBlocks: [] };
    expect(moveSectionArrangement(BLOCKS, open, 'STORY', -1)).toEqual({
      blocks: [{ type: 'STORY' }, { type: 'HERO' }, { type: 'VENUE' }, { type: 'RSVP' }],
    });
  });
});

describe('addSectionArrangement', () => {
  it('adds a section at the end, shown, after the ones that can be sent', () => {
    expect(addSectionArrangement(BLOCKS, TEMPLATE, 'CONTACT')).toEqual({
      blocks: [
        { type: 'HERO' },
        { type: 'VENUE' },
        { type: 'RSVP' },
        { type: 'CONTACT', enabled: true },
      ],
    });
  });
});

describe('moveQuestionOrder', () => {
  const questions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('sends every id in the new order with the order read', () => {
    expect(moveQuestionOrder(questions, 'c', -1)).toEqual({
      questionIds: ['a', 'c', 'b'],
      expectedOrder: ['a', 'b', 'c'],
    });
    expect(moveQuestionOrder(questions, 'a', -1)).toBeNull();
    expect(moveQuestionOrder(questions, 'c', 1)).toBeNull();
  });
});

describe('altTextEdit', () => {
  it('sends the languages changed, null for one emptied, and leaves the others alone', () => {
    const stored = { hy: 'Աննա', fr: 'Anna' };
    const baseline = { hy: 'Աննա', en: '' };
    expect(altTextEdit(stored, baseline, { hy: '', en: ' Anna and Davit ' })).toEqual({
      hy: null,
      en: 'Anna and Davit',
    });
    expect(altTextEdit(stored, baseline, { ...baseline })).toEqual({});
  });
});
