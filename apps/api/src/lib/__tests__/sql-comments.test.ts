import { describe, it, expect } from 'vitest';
import { stripLeadingSqlComments } from '../sql-comments';

describe('stripLeadingSqlComments', () => {
  it('strips leading line and block comments before SELECT', () => {
    expect(stripLeadingSqlComments('-- hello\nSELECT 1')).toBe('SELECT 1');
    expect(stripLeadingSqlComments('/* hello */\nSELECT 1')).toBe('SELECT 1');
    expect(stripLeadingSqlComments('/* hello */\n-- world\nSELECT 1')).toBe('SELECT 1');
  });
});
