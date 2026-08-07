import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ModernDataTable } from '../table';

describe('ModernDataTable', () => {
  it('renders rows with provided cells', () => {
    render(
      <ModernDataTable
        items={[
          { id: '1', name: 'AFG-1' },
          { id: '2', name: 'AFG-2' },
        ]}
        getRowKey={(item) => item.id}
        columns={[
          {
            key: 'name',
            header: 'Belge',
            cell: (item) => item.name,
          },
        ]}
      />,
    );

    expect(screen.getByText('Belge')).toBeInTheDocument();
    expect(screen.getByText('AFG-1')).toBeInTheDocument();
    expect(screen.getByText('AFG-2')).toBeInTheDocument();
  });

  it('renders the empty state when no rows exist', () => {
    render(
      <ModernDataTable
        items={[]}
        getRowKey={(_, index) => String(index)}
        columns={[
          {
            key: 'name',
            header: 'Belge',
            cell: () => null,
          },
        ]}
        emptyTitle="Boş"
        emptyDescription="Henüz veri yok."
      />,
    );

    expect(screen.getByText('Boş')).toBeInTheDocument();
    expect(screen.getByText('Henüz veri yok.')).toBeInTheDocument();
  });
});
