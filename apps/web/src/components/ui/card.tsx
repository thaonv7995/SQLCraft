import * as React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  interactive?: boolean;
}

export function Card({ className, elevated = false, interactive = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl',
        elevated ? 'bg-surface-container-high' : 'bg-surface-container-low',
        interactive && [
          'cursor-pointer',
          'transition-all duration-150',
          'hover:bg-surface-container',
          'hover:shadow-lg hover:shadow-black/20',
          'active:scale-[0.99]',
        ],
        className
      )}
      {...props}
    />
  );
}

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  border?: boolean;
}

export function CardHeader({ className, border = false, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between',
        'px-5 py-4',
        border && 'bg-surface-container',
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'font-headline text-base font-semibold text-on-surface tracking-tight',
        className
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm text-on-surface-variant font-body', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-5 py-4', className)} {...props} />
  );
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'px-5 py-4 flex items-center gap-3',
        className
      )}
      {...props}
    />
  );
}

// Stat card variant
interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  delta?: string;
  deltaPositive?: boolean;
  icon?: React.ReactNode;
  accent?: 'primary' | 'secondary' | 'tertiary' | 'error';
}

const accentMap = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  error: 'text-error',
};

export function StatCard({
  label,
  value,
  delta,
  deltaPositive,
  icon,
  accent = 'primary',
  className,
  ...props
}: StatCardProps) {
  return (
    <Card className={cn('flex h-full min-h-[7.25rem] flex-col p-4 sm:p-5', className)} {...props}>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Label + icon share one row so the icon centers to the label band (not the whole card). */}
        <div className="mb-2 flex min-h-[2.5rem] items-center justify-between gap-3 sm:min-h-[2.625rem]">
          <p
            className="min-w-0 flex-1 text-[11px] font-medium uppercase leading-snug tracking-wide text-on-surface-variant line-clamp-2 sm:text-xs sm:leading-snug"
            title={label}
          >
            {label}
          </p>
          {icon && (
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center text-[20px] leading-none opacity-85 sm:h-9 sm:w-9 sm:text-[22px]',
                accentMap[accent]
              )}
              aria-hidden
            >
              {icon}
            </div>
          )}
        </div>
        <p className="text-2xl font-headline font-bold tabular-nums text-on-surface">{value}</p>
        {delta && (
          <p
            className={cn(
              'mt-1 text-xs',
              deltaPositive ? 'text-secondary' : 'text-error'
            )}
          >
            {deltaPositive ? '+' : ''}
            {delta}
          </p>
        )}
      </div>
    </Card>
  );
}
