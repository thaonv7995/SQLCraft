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
    <Card className={cn('p-5', className)} {...props}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-2">
            {label}
          </p>
          <p className={cn('text-2xl font-headline font-bold', accentMap[accent])}>
            {value}
          </p>
          {delta && (
            <p
              className={cn(
                'text-xs mt-1',
                deltaPositive ? 'text-secondary' : 'text-error'
              )}
            >
              {deltaPositive ? '+' : ''}{delta}
            </p>
          )}
        </div>
        {icon && (
          <div className={cn('text-2xl opacity-60 shrink-0', accentMap[accent])}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
