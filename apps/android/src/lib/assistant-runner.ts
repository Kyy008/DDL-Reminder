import type { LocalAppState } from "./local-app-state";
import {
  createTaskProposal,
  queryAssistantTasks,
  type AssistantMessage,
  type TaskProposal
} from "./task-assistant";

export type ProposalOutcome = {
  status: "confirmed" | "cancelled" | "failed";
  message: string;
  task?: unknown;
};
export type AssistantRunnerDependencies = {
  complete: (messages: AssistantMessage[]) => Promise<AssistantMessage>;
  getState: () => Promise<LocalAppState>;
  review: (proposal: TaskProposal) => Promise<ProposalOutcome>;
  onText: (text: string) => void;
  onStatus: (text: string) => void;
};

// Finish every outstanding tool call, including after cancellation/errors, so the
// next user turn never starts with an invalid or partially executed tool batch.
export function settleOutstandingTools(messages: AssistantMessage[]) {
  const settled: AssistantMessage[] = [];
  let outstanding: string[] = [];
  const flush = () => {
    for (const id of outstanding)
      settled.push({
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify({
          status: "cancelled",
          message: "本轮已停止，未执行此操作。"
        })
      });
    outstanding = [];
  };
  for (const message of messages) {
    if (message.role === "tool") {
      if (outstanding.includes(message.tool_call_id ?? "")) {
        settled.push(message);
        outstanding = outstanding.filter((id) => id !== message.tool_call_id);
      }
    } else {
      flush();
      settled.push(message);
      outstanding = message.tool_calls?.map((call) => call.id) ?? [];
    }
  }
  flush();
  return settled;
}

export async function runAssistantTurn(
  history: AssistantMessage[],
  input: string,
  dependencies: AssistantRunnerDependencies,
  signal: AbortSignal
) {
  const messages: AssistantMessage[] = [
    ...history,
    { role: "user", content: input }
  ];
  let error: string | null = null;
  try {
    for (let round = 0; round < 10; round++) {
      signal.throwIfAborted();
      dependencies.onStatus("正在思考…");
      const reply = await dependencies.complete([...messages]);
      signal.throwIfAborted();
      messages.push(reply);
      if (reply.content) dependencies.onText(reply.content);
      if (!reply.tool_calls?.length) return { messages, error: null };
      if (reply.tool_calls.length > 8)
        throw new Error("这次操作过多，请分几次处理。");
      for (const call of reply.tool_calls) {
        signal.throwIfAborted();
        let result: unknown;
        try {
          const args: unknown = JSON.parse(call.function.arguments);
          if (call.function.name === "query_tasks") {
            dependencies.onStatus("正在查询任务…");
            result = queryAssistantTasks(await dependencies.getState(), args);
          } else if (call.function.name === "propose_task_change") {
            const proposal = createTaskProposal(
              await dependencies.getState(),
              args
            );
            dependencies.onStatus("请确认下面的任务操作");
            result = await dependencies.review(proposal);
          } else {
            result = {
              status: "failed",
              message: "不支持这个操作。只能查询任务或提出待确认的任务变更。"
            };
          }
        } catch (toolError) {
          result = {
            status: "failed",
            message:
              toolError instanceof Error
                ? toolError.message
                : "任务信息有误，操作未执行。"
          };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
    }
    throw new Error(
      "本轮处理步骤较多，已暂停。已经确认的操作会保留，其余操作没有执行。请缩小范围后继续。"
    );
  } catch (runError) {
    error = signal.aborted
      ? "已停止。未确认的操作没有执行。"
      : runError instanceof Error
        ? runError.message
        : "对话暂时无法继续，请稍后再试。";
    const settled = settleOutstandingTools(messages);
    settled.push({ role: "assistant", content: error });
    return { messages: settled, error };
  }
}
