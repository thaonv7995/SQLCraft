import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export function LessonMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn('lesson-markdown text-on-surface', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ className, ...props }) => (
            <h1
              className={cn(
                'font-headline text-3xl font-bold tracking-tight text-on-surface',
                className
              )}
              {...props}
            />
          ),
          h2: ({ className, ...props }) => (
            <h2
              className={cn(
                'mt-10 font-headline text-2xl font-semibold tracking-tight text-on-surface',
                className
              )}
              {...props}
            />
          ),
          h3: ({ className, ...props }) => (
            <h3
              className={cn(
                'mt-8 font-headline text-xl font-semibold tracking-tight text-on-surface',
                className
              )}
              {...props}
            />
          ),
          p: ({ className, ...props }) => (
            <p
              className={cn(
                'mt-4 text-[15px] leading-7 text-on-surface-variant',
                className
              )}
              {...props}
            />
          ),
          ul: ({ className, ...props }) => (
            <ul
              className={cn(
                'mt-4 list-disc space-y-2 pl-6 text-[15px] leading-7 text-on-surface-variant',
                className
              )}
              {...props}
            />
          ),
          ol: ({ className, ...props }) => (
            <ol
              className={cn(
                'mt-4 list-decimal space-y-2 pl-6 text-[15px] leading-7 text-on-surface-variant',
                className
              )}
              {...props}
            />
          ),
          li: ({ className, ...props }) => (
            <li className={cn('pl-1', className)} {...props} />
          ),
          strong: ({ className, ...props }) => (
            <strong className={cn('font-semibold text-on-surface', className)} {...props} />
          ),
          blockquote: ({ className, ...props }) => (
            <blockquote
              className={cn(
                'mt-6 rounded-r-xl border-l-4 border-primary/40 bg-surface-container px-4 py-3 text-sm italic text-on-surface-variant',
                className
              )}
              {...props}
            />
          ),
          a: ({ className, ...props }) => (
            <a
              className={cn(
                'font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:text-on-surface',
                className
              )}
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className);

            if (!isBlock) {
              return (
                <code
                  className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-[13px] text-on-surface"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                className={cn('block overflow-x-auto font-mono text-[13px] leading-6', className)}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ className, ...props }) => (
            <pre
              className={cn(
                'mt-6 overflow-x-auto rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 text-on-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
                className
              )}
              {...props}
            />
          ),
          hr: ({ className, ...props }) => (
            <hr className={cn('my-8 border-outline-variant/20', className)} {...props} />
          ),
          table: ({ className, ...props }) => (
            <div className="mt-6 overflow-x-auto rounded-xl border border-outline-variant/10">
              <table className={cn('min-w-full text-left text-sm', className)} {...props} />
            </div>
          ),
          th: ({ className, ...props }) => (
            <th
              className={cn(
                'bg-surface-container px-4 py-3 font-medium text-on-surface',
                className
              )}
              {...props}
            />
          ),
          td: ({ className, ...props }) => (
            <td
              className={cn(
                'border-t border-outline-variant/10 px-4 py-3 text-on-surface-variant',
                className
              )}
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
