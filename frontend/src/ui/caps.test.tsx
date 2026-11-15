import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { Icon } from './icon';
import { Eyebrow } from './section-heading';

describe('words shown in capitals (audit F-32, design PD-197)', () => {
  it('spell the Armenian ligature out in a button, keeping its icon', () => {
    render(
      <Button>
        <Icon name="check" />
        Ուղարկել և փակել
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Ուղարկել եվ փակել' });
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('spell it out in an eyebrow', () => {
    render(<Eyebrow>Երևան</Eyebrow>);
    expect(screen.getByText('Երեվան')).toBeInTheDocument();
  });
});
