import { Capacitor, registerPlugin } from "@capacitor/core";
import { z } from "zod";
import {
  ASSISTANT_TOOLS,
  assistantSystemPrompt,
  type AssistantMessage,
  type ThinkingEffort
} from "./task-assistant";

export const ASSISTANT_MODEL = "deepseek-flash";
export const ASSISTANT_MODEL_LABEL = "DeepSeek V4.1 Flash";
export type AssistantCredentialStatus = {
  hasKey: boolean;
  hasPreset: boolean;
  usingCustomKey: boolean;
};
type AssistantBridgePlugin = {
  getCredentialStatus(): Promise<AssistantCredentialStatus>;
  setApiKey(options: { key: string }): Promise<AssistantCredentialStatus>;
  complete(options: {
    requestId: string;
    payload: string;
  }): Promise<{ body: string }>;
  cancel(options: { requestId: string }): Promise<void>;
};
const AssistantBridge =
  registerPlugin<AssistantBridgePlugin>("AssistantBridge");
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable(),
        message: z.object({
          content: z.string().nullable().optional(),
          reasoning_content: z.string().optional().nullable(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1),
                type: z.literal("function"),
                function: z.object({ name: z.string(), arguments: z.string() })
              })
            )
            .max(8)
            .optional()
            .nullable()
        })
      })
    )
    .min(1)
});

export function nativeAssistantAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}
export async function getAssistantCredentialStatus(): Promise<AssistantCredentialStatus> {
  return nativeAssistantAvailable()
    ? AssistantBridge.getCredentialStatus()
    : { hasKey: false, hasPreset: false, usingCustomKey: false };
}
export async function setAssistantApiKey(key: string) {
  if (!nativeAssistantAvailable())
    throw new Error("API 密钥请在 Android 应用中设置，网页预览不会保存密钥。");
  return AssistantBridge.setApiKey({ key: key.trim() });
}
export function buildAssistantRequest(
  messages: AssistantMessage[],
  effort: ThinkingEffort,
  now = new Date()
) {
  return {
    model: ASSISTANT_MODEL,
    messages: [
      { role: "system", content: assistantSystemPrompt(now) },
      ...messages.map((message) =>
        message.role === "assistant"
          ? { ...message, reasoning_content: message.reasoning_content ?? "" }
          : message
      )
    ],
    tools: ASSISTANT_TOOLS,
    thinking: { type: effort === "off" ? "disabled" : "enabled" },
    reasoning_effort: effort === "off" ? "none" : effort,
    max_tokens: effort === "max" ? 32768 : 16384,
    stream: false
  };
}
export function parseAssistantResponse(body: string): AssistantMessage {
  const parsed = responseSchema.safeParse(JSON.parse(body));
  if (!parsed.success) throw new Error("AI 返回的信息格式不完整，请重试。");
  const choice = parsed.data.choices[0];
  if (choice.finish_reason === "length")
    throw new Error("本次回答超过了长度限制，请缩小问题范围后再试。");
  if (choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls")
    throw new Error("AI 没有完成这次回答，请重试。");
  const message = choice.message;
  if (!message.content && !message.tool_calls?.length)
    throw new Error("AI 这次没有返回内容，请重试。");
  if (
    new Set(message.tool_calls?.map((call) => call.id)).size !==
    (message.tool_calls?.length ?? 0)
  )
    throw new Error("AI 返回了重复的操作编号，本次操作已中止。");
  return {
    role: "assistant",
    content: message.content ?? null,
    ...(message.reasoning_content != null
      ? { reasoning_content: message.reasoning_content }
      : {}),
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {})
  };
}
export async function requestAssistantCompletion(
  messages: AssistantMessage[],
  effort: ThinkingEffort,
  signal: AbortSignal
) {
  if (!nativeAssistantAvailable())
    throw new Error("请在 Android 应用中使用对话；网页仅用于预览界面。");
  signal.throwIfAborted();
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void AssistantBridge.cancel({ requestId }).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const response = await AssistantBridge.complete({
      requestId,
      payload: JSON.stringify(buildAssistantRequest(messages, effort))
    });
    signal.throwIfAborted();
    return parseAssistantResponse(response.body);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
