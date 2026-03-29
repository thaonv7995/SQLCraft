import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMssqlShowPlanXml, summarizeMssqlShowPlan, wrapMssqlShowPlanJson } from './mssql-showplan-json';

const SAMPLE = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.564" Build="16.0.4245.2">
  <BatchSequence>
    <Batch>
      <Statements>
        <StmtSimple StatementText="SELECT * FROM authors" StatementId="1" StatementSubTreeCost="0.0032831" StatementEstRows="1" StatementType="SELECT">
          <QueryPlan DegreeOfParallelism="1">
            <RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="1" EstimatedTotalSubtreeCost="0.0032831">
              <RunTimeInformation>
                <RunTimeCountersPerThread Thread="0" ActualRows="23" ActualElapsedms="2" ActualCPUms="0" />
              </RunTimeInformation>
              <IndexScan />
            </RelOp>
          </QueryPlan>
        </StmtSimple>
      </Statements>
    </Batch>
  </BatchSequence>
</ShowPlanXML>`;

test('parse ShowPlan XML to JSON tree with attributes', () => {
  const parsed = parseMssqlShowPlanXml(SAMPLE) as Record<string, unknown>;
  const root = parsed.ShowPlanXML as Record<string, unknown>;
  assert.equal(root['@_Version'], '1.564');
  const stmt = (((root.BatchSequence as Record<string, unknown>).Batch as Record<string, unknown>)
    .Statements as Record<string, unknown>).StmtSimple as Record<string, unknown>;
  assert.equal(stmt['@_StatementText'], 'SELECT * FROM authors');
  const rel = ((stmt.QueryPlan as Record<string, unknown>).RelOp as Record<string, unknown>)['@_PhysicalOp'];
  assert.equal(rel, 'Clustered Index Scan');
});

test('summarizeMssqlShowPlan extracts cost, op, runtime', () => {
  const parsed = parseMssqlShowPlanXml(SAMPLE);
  const s = summarizeMssqlShowPlan(parsed);
  assert.equal(s.nodeType, 'Clustered Index Scan');
  assert.equal(s.totalCost, 0.0032831);
  assert.equal(s.actualRows, 23);
  assert.equal(s.actualTime, 2);
});

test('wrapMssqlShowPlanJson adds engine metadata', () => {
  const wrapped = wrapMssqlShowPlanJson(parseMssqlShowPlanXml(SAMPLE));
  assert.equal(wrapped.engine, 'sqlserver');
  assert.equal(wrapped.format, 'showplan_xml');
  assert.equal(wrapped.version, '1.564');
  assert.ok(wrapped.plan && typeof wrapped.plan === 'object');
});
