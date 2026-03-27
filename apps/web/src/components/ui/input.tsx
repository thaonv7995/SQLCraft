import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, leftIcon, rightIcon, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-on-surface-variant font-body"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="absolute left-3 text-on-surface-variant pointer-events-none">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              // Base
              'w-full',
              'bg-surface-container-high',
              'text-on-surface',
              'text-sm font-body',
              'rounded-lg',
              'h-9 px-3',
              // Placeholder
              'placeholder:text-outline',
              // Focus
              'outline-none',
              'ring-1 ring-transparent',
              'focus:ring-primary/40',
              // Transition
              'transition-all duration-150',
              // Disabled
              'disabled:opacity-40 disabled:cursor-not-allowed',
              // Autofill
              '[&:-webkit-autofill]:shadow-[inset_0_0_0_9999px_#2a2a2a]',
              '[&:-webkit-autofill]:[-webkit-text-fill-color:#e5e2e1]',
              // Error
              error && 'bg-error/5 ring-error/30 focus:ring-error/50',
              // Icons
              leftIcon && 'pl-9',
              rightIcon && 'pr-9',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 text-on-surface-variant pointer-events-none">
              {rightIcon}
            </span>
          )}
        </div>
        {error && (
          <p className="text-xs text-error font-body">{error}</p>
        )}
        {hint && !error && (
          <p className="text-xs text-on-surface-variant font-body">{hint}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// Textarea variant
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="text-sm font-medium text-on-surface-variant font-body"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            'w-full min-h-[80px]',
            'bg-surface-container-high',
            'text-on-surface text-sm font-body',
            'rounded-lg',
            'px-3 py-2',
            'placeholder:text-outline',
            'outline-none',
            'ring-1 ring-transparent',
            'focus:ring-primary/40',
            'transition-all duration-150',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'resize-y',
            error && 'bg-error/5 ring-error/30 focus:ring-error/50',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-error font-body">{error}</p>}
        {hint && !error && (
          <p className="text-xs text-on-surface-variant font-body">{hint}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

// Select variant
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, hint, options, id, ...props }, ref) => {
    const generatedId = React.useId();
    const selectId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm font-medium text-on-surface-variant font-body"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full',
            'bg-surface-container-high',
            'text-on-surface text-sm font-body',
            'rounded-lg',
            'h-9 px-3',
            'outline-none',
            'ring-1 ring-transparent',
            'focus:ring-primary/40',
            'transition-all duration-150',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'cursor-pointer',
            error && 'bg-error/5 ring-error/30',
            className
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-surface-container">
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-error font-body">{error}</p>}
        {hint && !error && (
          <p className="text-xs text-on-surface-variant font-body">{hint}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
