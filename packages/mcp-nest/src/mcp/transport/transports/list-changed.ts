import type { McpServer } from '@modelcontextprotocol/server';

export type ListChangedKind = 'tools' | 'resources' | 'prompts';

/**
 * Send `notifications/{kind}/list_changed` down a server's own connection —
 * the 2025-era delivery model, where change notifications are unsolicited
 * messages on a live channel (the standalone `GET` SSE stream of a stateful
 * Streamable HTTP session, or the stdio pipe).
 *
 * Skipped, silently, when:
 * - the server is not connected (a closed session, or a discarded probe), or
 * - the server did not advertise `{ kind: { listChanged: true } }` for this
 *   connection. The spec only lets a server send these after declaring it, and
 *   the SDK would reject the send anyway.
 *
 * Never throws and never leaves a rejected promise behind: the send is
 * asynchronous, so failures (a stream that died mid-write, …) are reported
 * through `onError` instead, letting the caller keep fanning out to other
 * sessions.
 */
export function sendListChanged(
  server: McpServer,
  kind: ListChangedKind,
  onError: (error: unknown) => void,
): void {
  const lowLevel = server.server;
  if (!lowLevel.transport) return;
  if (!lowLevel.getCapabilities()[kind]?.listChanged) return;

  let sent: Promise<void>;
  try {
    sent =
      kind === 'tools'
        ? lowLevel.sendToolListChanged()
        : kind === 'resources'
          ? lowLevel.sendResourceListChanged()
          : lowLevel.sendPromptListChanged();
  } catch (error) {
    onError(error);
    return;
  }
  sent.catch(onError);
}
