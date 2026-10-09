import { variantWidths } from './image-variants';

describe('variantWidths', () => {
  it.each([
    [4000, [480, 960, 1600]],
    [1600, [480, 960]],
    [1000, [480, 960]],
    [481, [480]],
    [480, []],
    [200, []],
  ])('makes copies of a %ipx-wide photo at %j — never enlarging', (width, expected) => {
    expect(variantWidths(width)).toEqual(expected);
  });
});
