'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: [
    'bg-primary',
    'text-on-primary',
    'font-semibold',
    'hover:brightness-110',
    'active:brightness-95',
    'border border-outline-variant',
  ].join(' '),

  secondary: [
    'bg-surface-container-high',
    'text-on-surface',
    'border border-outline-variant',
    'hover:bg-surface-container-highest',
    'active:bg-surface-bright',
  ].join(' '),

  ghost: [
    'bg-transparent',
    'text-on-surface-variant',
    'hover:bg-surface-container-high',
    'hover:text-on-surface',
    'active:bg-surface-container-highest',
  ].join(' '),

  destructive: [
    'bg-error/10',
    'text-error',
    'hover:bg-error/15',
    'active:bg-error/20',
  ].join(' '),
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-7 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

const sizeGapClasses: Record<ButtonSize, string> = {
  sm: 'gap-1.5',
  md: 'gap-2',
  lg: 'gap-2.5',
};

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    const spinnerSize =
      size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';

    const gapClass = sizeGapClasses[size];

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          // Base
          'inline-flex items-center justify-center',
          'rounded-lg',
          'font-body font-medium',
          'transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          'select-none',
          // Disabled
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
          // Variant
          variantClasses[variant],
          // Size
          sizeClasses[size],
          // Full width
          fullWidth && 'w-full',
          className
        )}
        {...props}
      >
        {loading ? (
          <Spinner className={spinnerSize} />
        ) : (
          <span
            className={cn(
              'inline-flex min-h-0 items-center',
              gapClass,
              fullWidth && 'w-full justify-center'
            )}
          >
            {leftIcon && (
              <span className="inline-flex shrink-0 items-center justify-center [&_.material-symbols-outlined]:block [&_.material-symbols-outlined]:leading-none">
                {leftIcon}
              </span>
            )}
            {children != null && children !== false && (
              <span className="inline-flex shrink-0 items-center">{children}</span>
            )}
            {rightIcon && (
              <span className="inline-flex shrink-0 items-center justify-center [&_.material-symbols-outlined]:block [&_.material-symbols-outlined]:leading-none">
                {rightIcon}
              </span>
            )}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
