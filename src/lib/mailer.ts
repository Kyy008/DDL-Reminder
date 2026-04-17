import nodemailer from "nodemailer";

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
