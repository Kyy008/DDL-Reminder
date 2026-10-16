export const ASSISTANT_SUGGESTIONS = [
  "今天有哪些任务要完成？",
  "帮我查一下还没完成的任务",
  "这周有哪些任务快到期了？",
  "有没有已经逾期的任务？",
  "把明天截止的任务列给我看看",
  "最近完成了哪些任务？",
  "哪些任务还没有设置截止时间？",
  "我想记一件事，帮我整理成任务",
  "帮我看看接下来三天的安排",
  "我想调整一个任务的截止时间",
  "今天该先处理哪件事？",
  "帮我找一个任务，我来描述一下",
  "帮我把一个大任务拆成几个小步骤",
  "最近的任务有点多，陪我理一下思路",
  "查一下我已经完成的任务有多少",
  "我想清理一个不再需要的任务"
] as const;

export function pickAssistantSuggestions(
  previous: readonly string[] = [],
  random = Math.random
): string[] {
  const candidates = ASSISTANT_SUGGESTIONS.filter(
    (suggestion) => !previous.includes(suggestion)
  );
  const pool: string[] =
    candidates.length >= 2 ? [...candidates] : [...ASSISTANT_SUGGESTIONS];
  const selected: string[] = [];
  while (selected.length < 2) {
    const index = Math.min(
      pool.length - 1,
      Math.max(0, Math.floor(random() * pool.length))
    );
    selected.push(pool.splice(index, 1)[0]);
  }
  return selected;
}
