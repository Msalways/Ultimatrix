'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface HoloColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
}

export function HoloTable<T extends { id?: string }>({
  data,
  columns,
  className,
}: {
  data: T[];
  columns: HoloColumn<T>[];
  className?: string;
}) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  return (
    <div className={cn('relative', className)}>
      <div className="panel-holographic rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-green-400/20">
              {columns.map((col) => (
                <th
                  key={col.id}
                  className="px-4 py-3 text-left text-sm font-medium text-green-100"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={i}
                onMouseEnter={() => setHoveredRow(i)}
                onMouseLeave={() => setHoveredRow(null)}
                className={cn(
                  'border-b border-gray-800/50 transition-colors',
                  hoveredRow === i && 'bg-green-400/5',
                )}
              >
                {columns.map((col) => (
                  <td key={col.id} className="px-4 py-3 text-sm text-gray-300">
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {data.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500 text-sm">
            No data
          </div>
        )}
      </div>
    </div>
  );
}
