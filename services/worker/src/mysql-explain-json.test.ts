import assert from 'node:assert/strict';
import test from 'node:test';
import { mysqlExplainJsonToPgShaped } from '@sqlcraft/mysql-explain';

const SIMPLE_MYSQL_JSON = {
  query_block: {
    select_id: 1,
    cost_info: {
      query_cost: '10.50',
    },
    nested_loop: [
      {
        table: {
          table_name: 'branches',
          access_type: 'ALL',
          rows_examined_per_scan: 300,
          rows_produced_per_join: 300,
          filtered: '100.00',
          cost_info: {
            read_cost: '10.00',
            eval_cost: '0.50',
            prefix_cost: '10.50',
          },
        },
      },
    ],
  },
};

test('mysqlExplainJsonToPgShaped maps FORMAT=JSON to Postgres-shaped Plan tree', () => {
  const out = mysqlExplainJsonToPgShaped(SIMPLE_MYSQL_JSON);
  assert.ok(out);
  // Single-step nested_loop collapses to the table node (no redundant Nested Loop wrapper).
  assert.equal(out!.Plan['Node Type'], 'Seq Scan');
  assert.equal(out!.Plan['Relation Name'], 'branches');
  assert.equal(out!.Plan['Total Cost'], 10.5);
  assert.equal(out!.Plan['Plan Rows'], 300);
});

/** Join: query_block.cost_info.query_cost and final row est. live on query_block, not on Nested Loop node. */
const TWO_TABLE_JOIN_JSON = {
  query_block: {
    select_id: 1,
    cost_info: {
      query_cost: '1100.8',
    },
    nested_loop: [
      {
        table: {
          table_name: 'branches',
          access_type: 'ALL',
          rows_examined_per_scan: 300,
          rows_produced_per_join: 300,
          filtered: '100.00',
          cost_info: {
            read_cost: '10.00',
            eval_cost: '21.00',
            prefix_cost: '31.0',
          },
        },
      },
      {
        table: {
          table_name: 'employees',
          access_type: 'ref',
          key: 'branch_id',
          rows_examined_per_scan: 9,
          rows_produced_per_join: 9,
          filtered: '100.00',
          cost_info: {
            prefix_cost: '1069.8',
          },
        },
      },
    ],
  },
};

test('mysqlExplainJsonToPgShaped merges query_block cost and planned rows onto Nested Loop root', () => {
  const out = mysqlExplainJsonToPgShaped(TWO_TABLE_JOIN_JSON);
  assert.ok(out);
  assert.equal(out!.Plan['Node Type'], 'Nested Loop');
  assert.equal(out!.Plan['Total Cost'], 1100.8);
  assert.equal(out!.Plan['Plan Rows'], 9);
  assert.ok(Array.isArray(out!.Plan.Plans));
  assert.equal(out!.Plan.Plans!.length, 2);
});

test('mysqlExplainJsonToPgShaped passes through already-normalized Plan', () => {
  const already = {
    Plan: {
      'Node Type': 'Seq Scan',
      'Relation Name': 't',
    },
  };
  const out = mysqlExplainJsonToPgShaped(already);
  assert.deepEqual(out, already);
});
