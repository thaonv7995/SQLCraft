import { describe, expect, it } from 'vitest';
import { isSqlServerWrappedPlan, tryMssqlPlanToPgShapedRoot } from '../mssql-plan-adapter';

const WRAPPED = {
  engine: 'sqlserver',
  format: 'showplan_xml',
  version: '1.564',
  plan: {
    ShowPlanXML: {
      '@_Version': '1.564',
      BatchSequence: {
        Batch: {
          Statements: {
            StmtSimple: {
              '@_StatementText': 'SELECT * FROM authors',
              '@_StatementSubTreeCost': '0.0032831',
              QueryPlan: {
                RelOp: {
                  '@_PhysicalOp': 'Clustered Index Scan',
                  '@_LogicalOp': 'Clustered Index Scan',
                  '@_EstimatedTotalSubtreeCost': '0.0032831',
                  '@_EstimateRows': '1',
                  RunTimeInformation: {
                    RunTimeCountersPerThread: {
                      '@_ActualRows': '23',
                      '@_ActualElapsedms': '2',
                    },
                  },
                  IndexScan: {
                    Object: {
                      '@_Database': '[s_test]',
                      '@_Schema': '[dbo]',
                      '@_Table': '[authors]',
                      '@_Index': '[PK__authors__723284FADC5BF4B3]',
                      '@_IndexKind': 'Clustered',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe('mssql-plan-adapter', () => {
  it('detects wrapped SQL Server plans', () => {
    expect(isSqlServerWrappedPlan(WRAPPED)).toBe(true);
    expect(isSqlServerWrappedPlan({ Plan: {} })).toBe(false);
  });

  it('maps ShowPlan RelOp to Postgres-shaped tree', () => {
    const root = tryMssqlPlanToPgShapedRoot(WRAPPED as Record<string, unknown>);
    expect(root).not.toBeNull();
    expect(root!['Node Type']).toBe('Clustered Index Scan');
    expect(root!['Total Cost']).toBeCloseTo(0.0032831, 6);
    expect(root!['Relation Name']).toBe('dbo.authors');
    expect(root!['Index Name']).toBe('PK__authors__723284FADC5BF4B3');
    expect(root!['Actual Rows']).toBe(23);
    expect(root!['Actual Total Time']).toBe(2);
    expect(root!.Plans).toBeUndefined();
  });
});
