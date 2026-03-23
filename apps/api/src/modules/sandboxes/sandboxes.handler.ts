import { FastifyRequest, FastifyReply } from 'fastify';
import { success, MESSAGES } from '../../lib/response';
import type { JwtPayload } from '../../plugins/auth';
import type { SandboxParams, SandboxResetParams } from './sandboxes.schema';
import { getSandbox, resetSandbox } from './sandboxes.service';

export async function getSandboxHandler(
  request: FastifyRequest<{ Params: SandboxParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { sandboxId } = request.params;
  const user = request.user as JwtPayload;
  const result = await getSandbox(sandboxId, user.sub, user.roles?.includes('admin') ?? false);
  reply.send(success(result, MESSAGES.SANDBOX_RETRIEVED));
}

export async function resetSandboxHandler(
  request: FastifyRequest<{ Params: SandboxResetParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const user = request.user as JwtPayload;
  const result = await resetSandbox(sessionId, user.sub, user.roles?.includes('admin') ?? false);
  reply.send(success(result, MESSAGES.SANDBOX_RESET_REQUESTED));
}
