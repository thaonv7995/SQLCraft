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

test('rewriteMysqlRestoreSqlForTargetDatabase strips USE and forces sandbox database', () => {
  const input =
    "/*!40101 USE `legacy_prod` */;\nUSE `other`;\nCREATE TABLE domains (id INT PRIMARY KEY);\n";
  const out = __private__.rewriteMysqlRestoreSqlForTargetDatabase('s_ab7fe6ef05634bf5', input);
  assert.match(out, /USE `s_ab7fe6ef05634bf5`;/);
  assert.doesNotMatch(out, /legacy_prod/);
  assert.doesNotMatch(out, /\bUSE `other`;/);
  assert.match(out, /CREATE TABLE domains/);
});

test('rewriteMysqlRestoreSqlForTargetDatabase rewrites qualified db.table into sandbox database', () => {
  const input = 'CREATE TABLE `pdns`.`domains` (`id` int NOT NULL);\n';
  const out = __private__.rewriteMysqlRestoreSqlForTargetDatabase('s_cacfe0b2fe7543b5', input);
  assert.match(out, /USE `s_cacfe0b2fe7543b5`/);
  assert.match(out, /CREATE TABLE `s_cacfe0b2fe7543b5`\.`domains`/);
  assert.doesNotMatch(out, /`pdns`/);
});

test('rewriteMysqlRestoreSqlForTargetDatabase rewrites qualified names when source DB only appears in CREATE', () => {
  const input = 'CREATE TABLE IF NOT EXISTS `myapp`.`users` (`id` int);\n';
  const out = __private__.rewriteMysqlRestoreSqlForTargetDatabase('s_x', input);
  assert.match(out, /CREATE TABLE IF NOT EXISTS `s_x`\.`users`/);
});

test('rewriteMysqlRestoreSqlForTargetDatabase rewrites qualified pdns even when USE points at mysql', () => {
  const input =
    "/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE */;\n/*!40101 USE `mysql` */;\n" +
    'CREATE TABLE `pdns`.`domains` (`id` int NOT NULL);\n' +
    "INSERT INTO `pdns`.`domains` VALUES (1);\n";
  const out = __private__.rewriteMysqlRestoreSqlForTargetDatabase('s_8bd364cebaef43c2', input);
  assert.doesNotMatch(out, /`pdns`/);
  assert.match(out, /CREATE TABLE `s_8bd364cebaef43c2`\.`domains`/);
  assert.match(out, /INSERT INTO `s_8bd364cebaef43c2`\.`domains`/);
  assert.doesNotMatch(out, /USE `mysql`/);
});

test('rewriteMysqlRestoreSqlForTargetDatabase handles mysqldump comments before qualified CREATE', () => {
  const input =
    'CREATE TABLE IF NOT EXISTS /*!40101 some comment */ `pdns`.`domains` (`id` int);\n';
  const out = __private__.rewriteMysqlRestoreSqlForTargetDatabase('s_x', input);
  assert.doesNotMatch(out, /`pdns`/);
  assert.match(out, /`s_x`\.`domains`/);
});

test('rewriteMysqlRestoreSqlForTargetDatabase rewrites backtick-db with unquoted table name', () => {
  const input = 'CREATE TABLE `pdns`.domains (`id` int NOT NULL);\n';
  const out = __private__.rewriteMysqlRestoreSqlForTargetDatabase('s_x', input);
  assert.doesNotMatch(out, /`pdns`/);
  assert.match(out, /CREATE TABLE `s_x`\.`domains`/);
});

test('rewriteMysqlRestoreSqlForTargetDatabase upgrades MySQL 4 TYPE= storage to ENGINE=', () => {
  const input =
    "CREATE TABLE `domains` (`id` int(11) NOT NULL auto_increment) TYPE=InnoDB;\n" +
    'CREATE TABLE `supermasters` (`ip` varchar(25)) TYPE=MyISAM;\n';
  const out = __private__.rewriteMysqlRestoreSqlForTargetDatabase('s_x', input);
  assert.match(out, /ENGINE=InnoDB/i);
  assert.match(out, /ENGINE=MyISAM/i);
  assert.doesNotMatch(out, /\bTYPE\s*=/i);
});

test('rewriteMysqlRestoreSqlForTargetDatabase does not rewrite db.table inside string literals', () => {
  const input =
    "INSERT INTO `pdns`.`domains` VALUES (1, 'again', 'product-751-factor-like-section', 'Skill contain evening recognize sens');\n" +
    "INSERT INTO `pdns`.`domains` VALUES (2, 'see pdns.slots in text', 'x');\n";
  const out = __private__.rewriteMysqlRestoreSqlForTargetDatabase('s_x', input);
  assert.match(out, /INSERT INTO `s_x`\.`domains`/);
  assert.match(out, /'see pdns\.slots in text'/);
  assert.match(out, /'again'/);
});

test('rewriteMysqlRestoreSqlForTargetDatabase does not rewrite backtick-qualified names inside quoted strings', () => {
  const input =
    "INSERT INTO `pdns`.`domains` VALUES (1, 'note `pdns`.`domains` copied');\n";
  const out = __private__.rewriteMysqlRestoreSqlForTargetDatabase('s_x', input);
  assert.match(out, /INSERT INTO `s_x`\.`domains`/);
  assert.match(out, /'note `pdns`\.`domains` copied'/);
});
