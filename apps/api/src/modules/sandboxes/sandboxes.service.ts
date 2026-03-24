import { sandboxesRepository } from '../../db/repositories';
import type { DatasetTemplateRow } from '../../db/repositories/sandboxes.repository';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { getLargestDatasetScale, isDatasetScaleAllowed } from '../../lib/dataset-scales';
import type { DatasetSize } from '@sqlcraft/types';
import { enqueueResetSandbox } from '../../lib/queue';
import type { GetSandboxResult, ResetSandboxResult } from './sandboxes.types';
import type { SandboxResetBody } from './sandboxes.schema';

async function resolveResetDatasetTemplate(
  sandbox: Awaited<ReturnType<typeof sandboxesRepository.findBySessionId>>,
  requestedScale?: DatasetSize,
): Promise<DatasetTemplateRow | null> {
  if (!sandbox?.schemaTemplateId) {
    if (requestedScale) {
      throw new ValidationError('This sandbox does not support dataset scale changes');
    }

    if (!sandbox?.datasetTemplateId) {
      return null;
    }

    return sandboxesRepository.findDatasetTemplateById(sandbox.datasetTemplateId);
  }

  const schemaTemplates = await sandboxesRepository.listPublishedDatasetTemplatesBySchema(
    sandbox.schemaTemplateId,
  );
  const sourceScale = getLargestDatasetScale(
    schemaTemplates.map((datasetTemplate) => datasetTemplate.size as DatasetSize),
  );

  if (!requestedScale) {
    return (
      schemaTemplates.find((datasetTemplate) => datasetTemplate.id === sandbox.datasetTemplateId) ??
      (sandbox.datasetTemplateId
        ? await sandboxesRepository.findDatasetTemplateById(sandbox.datasetTemplateId)
        : null)
    );
  }

  if (!isDatasetScaleAllowed(requestedScale, sourceScale)) {
    throw new ValidationError('Requested dataset scale exceeds the source dataset scale');
  }

  const targetTemplate =
    schemaTemplates.find((datasetTemplate) => datasetTemplate.size === requestedScale) ?? null;

  if (!targetTemplate) {
    throw new ValidationError('Requested dataset scale is not available for this sandbox');
  }

  return targetTemplate;
}

export async function getSandbox(
  sandboxId: string,
  userId: string,
  isAdmin: boolean,
): Promise<GetSandboxResult> {
  const sandbox = await sandboxesRepository.findById(sandboxId);

  if (!sandbox) {
    throw new NotFoundError('Sandbox not found');
  }

  const sessionUserId = await sandboxesRepository.getSessionUserIdBySandbox(sandboxId);

  if (sessionUserId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this sandbox');
  }

  return {
    id: sandbox.id,
    learningSessionId: sandbox.learningSessionId,
    status: sandbox.status,
    dbName: sandbox.dbName,
    expiresAt: sandbox.expiresAt,
    createdAt: sandbox.createdAt,
    updatedAt: sandbox.updatedAt,
  };
}

export async function resetSandbox(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
  body: SandboxResetBody,
): Promise<ResetSandboxResult> {
  const session = await sandboxesRepository.findSessionById(sessionId);

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  if (session.userId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this session');
  }

  const sandbox = await sandboxesRepository.findBySessionId(sessionId);

  if (!sandbox) {
    throw new NotFoundError('Sandbox not found for this session');
  }

  const targetTemplate = await resolveResetDatasetTemplate(
    sandbox,
    body.datasetSize ?? body.scale ?? body.selectedScale,
  );

  const now = new Date();

  if (targetTemplate?.id !== sandbox.datasetTemplateId) {
    await sandboxesRepository.updateDatasetTemplate(sandbox.id, targetTemplate?.id ?? null);
  }

  await sandboxesRepository.setResetting(sandbox.id);

  await enqueueResetSandbox({
    sandboxInstanceId: sandbox.id,
    learningSessionId: sessionId,
  });

  return {
    sandboxId: sandbox.id,
    status: 'resetting',
    requestedAt: now,
  };
}
