import { describe, expect, it } from 'vitest';
import { __private__, type SqlEditorSchemaTable } from './sql-editor';

function unwrapNamespaceTag(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || !('self' in value)) {
    throw new Error('Expected namespace tag');
  }

  return value as {
    self: {
      label: string;
      type: string;
      detail?: string;
      info?: string;
    };
    children: unknown;
  };
}

describe('buildCompletionSchema', () => {
  it('builds table-level and top-level column completions from session schema', () => {
    const schema = __private__.buildCompletionSchema([
      {
        name: 'countries',
        columns: [
          { name: 'code', type: 'char(2)', isPrimary: true },
          { name: 'name', type: 'text' },
        ],
      },
      {
        name: 'cities',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true },
          { name: 'country_code', type: 'char(2)', isForeign: true, references: 'countries.code' },
          { name: 'name', type: 'text' },
        ],
      },
    ] satisfies SqlEditorSchemaTable[]);

    expect(schema).toBeDefined();
    expect(schema).not.toBeNull();
    expect(Array.isArray(schema)).toBe(false);

    const namespace = schema as Record<string, unknown>;
    const countries = unwrapNamespaceTag(namespace.countries);
    const cities = unwrapNamespaceTag(namespace.cities);

    expect(countries.self).toMatchObject({
      label: 'countries',
      type: 'table',
      detail: '2 cols',
    });
    expect(cities.self).toMatchObject({
      label: 'cities',
      type: 'table',
      detail: '3 cols',
    });

    expect(countries.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'code', type: 'property', detail: 'char(2) · PK' }),
        expect.objectContaining({ label: 'name', type: 'property', detail: 'text' }),
      ]),
    );
    expect(cities.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'country_code',
          type: 'property',
          detail: 'char(2) · FK',
          info: 'cities.country_code → countries.code',
        }),
      ]),
    );

    const topLevelEntries = Object.values(namespace)
      .filter(__private__.isNamespaceTag)
      .map((entry) => entry.self);
    const byLabel = new Map(topLevelEntries.map((entry) => [entry.label, entry]));

    expect(Array.from(byLabel.keys()).some((label) => label.startsWith('__sqlforge'))).toBe(false);
    expect(byLabel.get('code')).toMatchObject({
      label: 'code',
      type: 'property',
      detail: 'char(2) · PK',
      info: 'Available in countries',
    });
    expect(byLabel.get('name')).toMatchObject({
      label: 'name',
      type: 'property',
      detail: 'text',
      info: 'Available in countries, cities',
    });
  });
});
