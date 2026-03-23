import * as React from 'react';
import { cn } from '@/lib/utils';

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  stickyHeader?: boolean;
}

export function Table({ className, stickyHeader = false, ...props }: TableProps) {
  return (
    <div className="w-full overflow-auto">
      <table
        className={cn(
          'w-full border-collapse text-sm font-body',
          stickyHeader && '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10',
          className
        )}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'bg-surface-container-high',
        className
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        '[&>tr:nth-child(odd)]:bg-surface [&>tr:nth-child(even)]:bg-surface-container-low',
        '[&>tr]:transition-colors [&>tr]:duration-100',
        '[&>tr:hover]:bg-surface-container',
        className
      )}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('group', className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'px-4 py-3',
        'text-left',
        'text-xs font-semibold uppercase tracking-wider',
        'text-on-surface-variant',
        'whitespace-nowrap',
        'select-none',
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'px-4 py-3',
        'text-sm text-on-surface',
        'align-middle',
        className
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      className={cn('mt-4 text-sm text-on-surface-variant', className)}
      {...props}
    />
  );
}

// Empty state for tables
interface TableEmptyProps {
  message?: string;
  colSpan?: number;
}

export function TableEmpty({ message = 'No data available', colSpan = 10 }: TableEmptyProps) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-12 text-center text-sm text-on-surface-variant font-body"
      >
        <span className="material-symbols-outlined text-3xl text-outline mb-2 block">
          table_rows
        </span>
        {message}
      </td>
    </tr>
  );
}

// Loading skeleton for tables
interface TableSkeletonProps {
  rows?: number;
  cols?: number;
}

export function TableSkeleton({ rows = 5, cols = 4 }: TableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <div
                className="h-4 bg-surface-container-highest rounded animate-pulse"
                style={{ width: `${Math.floor(Math.random() * 40) + 40}%` }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
