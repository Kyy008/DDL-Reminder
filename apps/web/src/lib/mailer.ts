import nodemailer from "nodemailer";
import { DEFAULT_TIME_ZONE } from "./deadline";
import { ReminderTypeValue } from "./task-constants";

type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export async function sendMail(input: SendMailInput) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const transporter = nodemailer.createTransport({
    host: requiredEnv("SMTP_HOST"),
    port: Number.parseInt(requiredEnv("SMTP_PORT"), 10),
    secure: process.env.SMTP_SECURE === "true",
    ...(smtpUser && smtpPass
      ? {
          auth: {
            user: smtpUser,
            pass: smtpPass
          }
        }
      : {})
  });

  await transporter.sendMail({
    from: requiredEnv("MAIL_FROM"),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html
  });
}

export async function sendActivationEmail({
  activationUrl,
  email,
  username
}: {
  activationUrl: string;
  email: string;
  username: string;
}) {
  await sendMail({
    to: email,
    subject: "激活你的 DDL Reminder 账号",
    text: [
      `${username}，你好：`,
      "",
      "点击下面的链接激活你的 DDL Reminder 账号：",
      activationUrl,
      "",
      "这个链接 24 小时内有效。"
    ].join("\n"),
    html: `
      <p>${escapeHtml(username)}，你好：</p>
      <p>点击下面的链接激活你的 DDL Reminder 账号：</p>
      <p><a href="${escapeHtml(activationUrl)}">${escapeHtml(activationUrl)}</a></p>
      <p>这个链接 24 小时内有效。</p>
    `
  });
}

export async function sendTaskDeadlineReminderEmail({
  dueAt,
  email,
  reminderType,
  taskTitle,
  username
}: {
  dueAt: Date;
  email: string;
  reminderType: ReminderTypeValue;
  taskTitle: string;
  username: string;
}) {
  const reminderLabel =
    reminderType === "DUE_IN_2H" ? "已进入紧急截止状态" : "已进入临期截止状态";
  const dueAtText = formatDateTime(dueAt);
  const subject =
    reminderType === "DUE_IN_2H"
      ? `紧急提醒：${taskTitle}`
      : `临期提醒：${taskTitle}`;

  await sendMail({
    to: email,
    subject,
    text: [
      `${username}，你好：`,
      "",
      `你的任务「${taskTitle}」${reminderLabel}。`,
      `DDL：${dueAtText}`,
      "",
      "请及时处理。"
    ].join("\n"),
    html: `
      <p>${escapeHtml(username)}，你好：</p>
      <p>你的任务「${escapeHtml(taskTitle)}」${escapeHtml(reminderLabel)}。</p>
      <p>DDL：${escapeHtml(dueAtText)}</p>
      <p>请及时处理。</p>
    `
  });
}

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}
