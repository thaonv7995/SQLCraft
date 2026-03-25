import assert from 'node:assert/strict';
import test from 'node:test';
import { __private__ } from './dataset-loader';

test('seeds non-serial fixed-width primary keys', () => {
  const schema = {
    tables: [
      {
        name: 'countries',
        columns: [
          { name: 'country_code', type: 'CHAR(2) PRIMARY KEY' },
          { name: 'country_name', type: 'TEXT NOT NULL UNIQUE' },
        ],
      },
    ],
  };

  const tables = __private__.parseSchemaTables(schema);
  const tablesByName = new Map(tables.map((table) => [table.name, table]));
  const rowCounts = __private__.normalizeRowCounts({ countries: 8 });
  const countries = tablesByName.get('countries');
  const countryCode = countries?.columns.find((column) => column.name === 'country_code');

  assert.ok(countryCode);

  const expression = __private__.inferColumnExpression(
    'countries',
    countryCode,
    rowCounts,
    tablesByName,
  );

  assert.ok(expression);
  assert.match(expression, /substring\(upper\(md5/);
  assert.match(expression, /for 2\)/);
});

test('seeds char foreign keys from referenced primary-key domain', () => {
  const schema = {
    tables: [
      {
        name: 'countries',
        columns: [
          { name: 'country_code', type: 'CHAR(2) PRIMARY KEY' },
          { name: 'country_name', type: 'TEXT NOT NULL UNIQUE' },
        ],
      },
      {
        name: 'cities',
        columns: [
          { name: 'city_id', type: 'BIGSERIAL PRIMARY KEY' },
          { name: 'country_code', type: 'CHAR(2) NOT NULL references countries(country_code)' },
          { name: 'city_name', type: 'TEXT NOT NULL' },
        ],
      },
    ],
  };

  const tables = __private__.parseSchemaTables(schema);
  const tablesByName = new Map(tables.map((table) => [table.name, table]));
  const rowCounts = __private__.normalizeRowCounts({ countries: 8, cities: 10 });
  const cities = tablesByName.get('cities');
  const countryCode = cities?.columns.find((column) => column.name === 'country_code');

  assert.ok(countryCode);

  const expression = __private__.inferColumnExpression(
    'cities',
    countryCode,
    rowCounts,
    tablesByName,
  );

  assert.ok(expression);
  assert.match(expression, /countries_country_code_/);
  assert.match(expression, /% 8/);
  assert.match(expression, /for 2\)/);
});

test('keeps serial primary keys on defaults', () => {
  const schema = {
    tables: [
      {
        name: 'cities',
        columns: [
          { name: 'city_id', type: 'BIGSERIAL PRIMARY KEY' },
          { name: 'city_name', type: 'TEXT NOT NULL' },
        ],
      },
    ],
  };

  const tables = __private__.parseSchemaTables(schema);
  const tablesByName = new Map(tables.map((table) => [table.name, table]));
  const rowCounts = __private__.normalizeRowCounts({ cities: 3 });
  const cities = tablesByName.get('cities');
  const cityId = cities?.columns.find((column) => column.name === 'city_id');

  assert.ok(cityId);

  const expression = __private__.inferColumnExpression('cities', cityId, rowCounts, tablesByName);

  assert.equal(expression, null);
});

test('maps BOOLEAN columns to boolean seed expressions', () => {
  const schema = {
    tables: [
      {
        name: 'courses',
        columns: [
          { name: 'course_id', type: 'BIGSERIAL PRIMARY KEY' },
          { name: 'is_published', type: 'BOOLEAN NOT NULL' },
        ],
      },
    ],
  };

  const tables = __private__.parseSchemaTables(schema);
  const tablesByName = new Map(tables.map((table) => [table.name, table]));
  const rowCounts = __private__.normalizeRowCounts({ courses: 3 });
  const courses = tablesByName.get('courses');
  const isPublished = courses?.columns.find((column) => column.name === 'is_published');

  assert.ok(isPublished);

  const expression = __private__.inferColumnExpression(
    'courses',
    isPublished,
    rowCounts,
    tablesByName,
  );

  assert.equal(expression, '(((i) % 2) = 0)');
});
