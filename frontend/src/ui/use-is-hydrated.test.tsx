import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useIsHydrated } from './use-is-hydrated';

function Probe() {
  return <span>{useIsHydrated() ? 'hydrated' : 'server'}</span>;
}

describe('useIsHydrated', () => {
  it('is false in the server render, so a submit button starts disabled', () => {
    expect(renderToString(<Probe />)).toContain('server');
  });

  it('is true once rendering in the browser', () => {
    render(<Probe />);
    expect(screen.getByText('hydrated')).toBeInTheDocument();
  });
});
