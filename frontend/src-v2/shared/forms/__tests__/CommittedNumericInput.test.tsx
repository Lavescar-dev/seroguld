import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommittedNumericInput } from '../CommittedNumericInput';

function DecimalField({ onCommit }: { onCommit: (value: number | null, canonical: string) => void }) {
  const [value, setValue] = useState<number | null>(2);
  return (
    <CommittedNumericInput
      aria-label="Test oranı"
      value={value}
      rules={{ kind: 'decimal', required: false, allowNegative: false, min: 0, precision: 4 }}
      onCommit={(nextValue, canonical) => {
        setValue(nextValue);
        onCommit(nextValue, canonical);
      }}
    />
  );
}

describe('CommittedNumericInput', () => {
  it('keeps a raw draft while the clerk clears and rewrites a decimal value', () => {
    const onCommit = vi.fn();
    render(<DecimalField onCommit={onCommit} />);

    const input = screen.getByRole('textbox', { name: 'Test oranı' });
    expect(input).toHaveValue('2.0000');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: '12,5' } });
    expect(input).toHaveValue('12,5');

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(12.5, '12.5000');
    expect(input).toHaveValue('12.5000');
  });
});
