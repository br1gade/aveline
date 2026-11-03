import { describe, expect, it } from 'vitest';

import { isFoundIn, latinOf, nameKey, normalizeName, queryForms } from './name-search';

const latin = latinOf;

describe('normalizeName', () => {
  it('ignores case and accents, in every script', () => {
    expect(normalizeName('Пётр')).toBe('петр');
    expect(normalizeName('ANI')).toBe('ani');
    expect(normalizeName('Ǻnne')).toBe('anne');
  });
});

describe('latinOf', () => {
  it.each([
    ['Արմեն Պետրոսյան', 'armen petrosyan'],
    ['Եղիազարյան', 'yeghiazaryan'],
    ['Ղազարյան', 'ghazaryan'],
    ['Ոսկանյան', 'voskanyan'],
    ['Խաչատրյան', 'khachatryan'],
    ['Հակոբյան', 'hakobyan'],
    ['Ծատուրյան', 'tsaturyan'],
    ['Ջուլիետա', 'julieta'],
    ['Լուսինե', 'lusine'],
    ['Երևան', 'yerevan'],
    ['Անի Վարդանյան-Եսայան', 'ani vardanyan-yesayan'],
  ])('writes the Armenian “%s” as “%s”', (name, expected) => {
    expect(latin(name)).toBe(expected);
  });

  it.each([
    ['Анна Щербакова', 'anna shcherbakova'],
    ['Юлия', 'yuliya'],
    ['Ёлкин', 'elkin'],
    ['Хачатрян', 'khachatryan'],
    ['Царукян', 'tsarukyan'],
    ['Подъячев', 'podyachev'],
    ['Сергей Йошкин', 'sergey yoshkin'],
    ['АНДРЕЙ', 'andrey'],
  ])('writes the Russian “%s” as “%s”', (name, expected) => {
    expect(latin(name)).toBe(expected);
  });

  it('leaves Latin, digits and other characters as they are', () => {
    expect(latin('Anna-Maria O’Neil 2')).toBe('anna-maria o’neil 2');
  });
});

describe('nameKey', () => {
  it('holds the name and its Latin form, so either finds it', () => {
    expect(nameKey('Արմեն')).toBe('արմեն\narmen');
  });

  it('holds a Latin name once', () => {
    expect(nameKey('Anna')).toBe('anna');
  });
});

describe('queryForms', () => {
  it('gives what was typed, and its Latin form when that differs', () => {
    expect(queryForms('Анна')).toEqual(['анна', 'anna']);
    expect(queryForms('Armen')).toEqual(['armen']);
  });

  it('finds across alphabets, and not what isn’t there', () => {
    const matches = (key: string, typed: string) => isFoundIn(key, queryForms(typed));
    expect(matches(nameKey('Արմեն Պետրոսյան'), 'armen')).toBe(true);
    expect(matches(nameKey('Anna Petrosyan'), 'Анна')).toBe(true);
    expect(matches(nameKey('Анна Петросян'), 'Աննա')).toBe(true);
    expect(matches(nameKey('Արմեն Պետրոսյան'), 'davit')).toBe(false);
  });

  it('finds й typed as y, and as и without its mark', () => {
    const matches = (key: string, typed: string) => isFoundIn(key, queryForms(typed));
    expect(matches(nameKey('Сергей'), 'Sergey')).toBe(true);
    expect(matches(nameKey('Сергей'), 'сергеи')).toBe(true);
    expect(matches(nameKey('Sergey Petrov'), 'Сергей')).toBe(true);
  });

  it('never matches across the seam between a name and its Latin form', () => {
    const matches = (key: string, typed: string) => isFoundIn(key, queryForms(typed));
    expect(matches(nameKey('Анна Петросян'), 'петросян anna')).toBe(false);
  });
});
