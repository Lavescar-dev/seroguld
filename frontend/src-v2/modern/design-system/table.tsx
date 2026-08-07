import { type ReactNode } from 'react';

import { cn } from './cn';
import { ModernEmptyState } from './states';

export interface ModernDataTableColumn<TItem> {
  key: string;
  header: string;
  className?: string;
  align?: 'left' | 'right' | 'center';
  cell: (item: TItem) => ReactNode;
}

export function ModernDataTable<TItem>({
  columns,
  items,
  emptyTitle = 'Kayıt bulunamadı',
  emptyDescription = 'Bu görünüm için henüz gösterilecek satır yok.',
  getRowKey,
}: {
  columns: ModernDataTableColumn<TItem>[];
  items: TItem[];
  emptyTitle?: string;
  emptyDescription?: string;
  getRowKey: (item: TItem, index: number) => string;
}) {
  if (items.length === 0) {
    return <ModernEmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <div className="max-w-full overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    'whitespace-nowrap border-b border-slate-200 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500',
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={getRowKey(item, index)} className="border-b border-slate-100 last:border-b-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-4 py-3 align-top text-slate-700',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.className,
                    )}
                  >
                    {column.cell(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
