import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecutionPlanTree } from './execution-plan-tree';

describe('ExecutionPlanTree', () => {
  it('renders tree nodes, index hit/miss badges, and bottleneck hints', () => {
    const markup = renderToStaticMarkup(
      <ExecutionPlanTree
        executionPlan={{
          type: 'json',
          mode: 'explain_analyze',
          totalCost: 180,
          actualTime: 14.5,
          plan: {
            Plan: {
              'Node Type': 'Nested Loop',
              'Total Cost': 180,
              'Actual Total Time': 14.5,
              'Actual Rows': 20,
              Plans: [
                {
                  'Node Type': 'Seq Scan',
                  'Relation Name': 'orders',
                  'Total Cost': 140,
                  'Actual Total Time': 11,
                  'Actual Rows': 12000,
                  'Actual Loops': 1,
                  'Filter': 'status = shipped',
                },
                {
                  'Node Type': 'Index Scan',
                  'Relation Name': 'customers',
                  'Index Name': 'customers_pkey',
                  'Total Cost': 40,
                  'Actual Total Time': 1.2,
                  'Actual Rows': 20,
                  'Actual Loops': 20,
                  'Index Cond': 'id = orders.customer_id',
                  'Shared Hit Blocks': 64,
                  'Shared Read Blocks': 2,
                },
              ],
            },
          },
        }}
      />,
    );

    expect(markup).toContain('Nested Loop');
    expect(markup).toContain('orders');
    expect(markup).toContain('customers via customers_pkey');
    expect(markup).toContain('Hit');
    expect(markup).toContain('Miss');
    expect(markup).toContain('Bottleneck');
    expect(markup).toContain('12.0K');
    expect(markup).toContain('Consumes 76% of total runtime');
  });
});
