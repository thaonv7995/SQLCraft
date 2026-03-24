import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LessonMarkdown } from './lesson-markdown';

describe('LessonMarkdown', () => {
  it('renders headings, inline code, and fenced SQL blocks', () => {
    render(
      <LessonMarkdown
        content={[
          '# SELECT basics',
          '',
          'Use `WHERE` to filter rows.',
          '',
          '```sql',
          'SELECT *',
          'FROM users',
          'WHERE active = true;',
          '```',
        ].join('\n')}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'SELECT basics' }),
    ).toBeInTheDocument();
    expect(screen.getByText('WHERE')).toBeInTheDocument();
    expect(screen.getByText(/FROM users/)).toBeInTheDocument();
    expect(screen.getByText(/WHERE active = true;/)).toBeInTheDocument();
  });
});
