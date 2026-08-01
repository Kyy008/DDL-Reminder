export const TASK_ERROR_MESSAGES = {
  createFailed: "任务创建失败，请稍后再试。",
  dateInvalid: "请输入有效的截止时间。",
  dateRangeInvalid: "截止时间必须晚于开始时间。",
  duplicateTitle: "已有同名任务，请换一个标题。",
  idInvalid: "无法识别该任务，请重试。",
  notFound: "找不到该任务，可能已被删除。",
  titleRequired: "请输入任务标题。"
} as const;
