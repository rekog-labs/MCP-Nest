import { Ctx, Payload } from '@nestjs/microservices';
import { inputRequired, McpContext, McpController, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { DeployState, stateCodec } from './state';

const CONFIRM = z.object({ confirm: z.boolean() });
const REASON = z.object({ reason: z.string().min(3) });

@McpController()
export class DeployTool {
  /**
   * A write-once, two-step tool. Round 1 asks for confirmation; round 2 asks for
   * a reason; round 3 deploys. Nothing is kept in server memory between rounds:
   * the step lives in the signed `requestState`, the answers arrive in
   * `inputResponses`.
   *
   * The same code serves both eras. A 2026-07-28 client retries the call
   * itself; a 2025-era client gets real `elicitation/create` requests from the
   * SDK's shim and never sees a difference.
   */
  @Tool({
    name: 'deploy',
    description:
      'Deploys to an environment after the user confirms and gives a reason',
    parameters: z.object({ env: z.string().describe('Target environment') }),
  })
  async deploy(@Payload() { env }: { env: string }, @Ctx() ctx: McpContext) {
    // Verified + decoded by the codec before this handler ran. `undefined` on
    // the first round.
    const state = ctx.getRequestState<DeployState>();
    const step = state?.step ?? 'confirm';
    console.log(`[deploy] era=${ctx.getSession().era} step=${step} env=${env}`);

    if (step === 'confirm') {
      const confirmed = ctx.getAcceptedContent('confirm', CONFIRM);
      if (!confirmed?.confirm) {
        // Missing, declined, cancelled or schema-invalid: ask (again).
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Deploy to ${env}?`,
              requestedSchema: CONFIRM,
            }),
          },
          requestState: await stateCodec.mint({ step: 'confirm', env }),
        });
      }
      // Confirmed — move to the next step. The env is carried in the state so a
      // retry cannot swap it under us.
      return inputRequired({
        inputRequests: {
          reason: inputRequired.elicit({
            message: `Why are you deploying to ${env}?`,
            requestedSchema: REASON,
          }),
        },
        requestState: await stateCodec.mint({ step: 'reason', env }),
      });
    }

    // step === 'reason'
    const reason = ctx.getAcceptedContent('reason', REASON);
    if (!reason) {
      const view = ctx.getInputResponse('reason');
      if (view.kind === 'elicit' && view.action !== 'accept') {
        return {
          content: [{ type: 'text', text: `deployment to ${state!.env} aborted` }],
        };
      }
      return inputRequired({
        inputRequests: {
          reason: inputRequired.elicit({
            message: `A reason is required (at least 3 characters).`,
            requestedSchema: REASON,
          }),
        },
        requestState: await stateCodec.mint({ step: 'reason', env: state!.env }),
      });
    }
    return {
      content: [
        {
          type: 'text',
          text: `deployed to ${state!.env} — reason: ${reason.reason}`,
        },
      ],
    };
  }

  /** Sampling through MRTR: the client's model answers, the tool reads it back. */
  @Tool({
    name: 'capital',
    description: 'Asks the client-side model for the capital of a country',
    parameters: z.object({ country: z.string() }),
  })
  capital(@Payload() { country }: { country: string }, @Ctx() ctx: McpContext) {
    const answer = ctx.getInputResponse('answer');
    if (answer.kind !== 'sampling') {
      return inputRequired({
        inputRequests: {
          answer: inputRequired.createMessage({
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `What is the capital of ${country}? Answer with the city only.`,
                },
              },
            ],
            maxTokens: 20,
          }),
        },
      });
    }
    const content = answer.result.content as { type: string; text?: string };
    return {
      content: [
        { type: 'text', text: `The model says: ${content.text ?? '(non-text answer)'}` },
      ],
    };
  }

  /** Roots through MRTR. */
  @Tool({
    name: 'list-roots',
    description: "Lists the client's workspace roots",
    parameters: z.object({}),
  })
  listRoots(@Payload() _args: unknown, @Ctx() ctx: McpContext) {
    const roots = ctx.getInputResponse('roots');
    if (roots.kind !== 'roots') {
      return inputRequired({ inputRequests: { roots: inputRequired.listRoots() } });
    }
    const lines = roots.roots.map((r) => `${r.name ?? '(unnamed)'}: ${r.uri}`);
    return { content: [{ type: 'text', text: lines.join('\n') || '(no roots)' }] };
  }
}
