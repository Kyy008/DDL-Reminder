export const AUTH_ERROR_MESSAGES = {
  activationEmailFailed: "激活邮件发送失败，请稍后再试。",
  duplicateAccount: "该邮箱或用户名已被注册。",
  emailInvalid: "请输入有效的邮箱地址。",
  emailRequired: "请输入邮箱地址。",
  emailTooLong: "邮箱地址过长。",
  identifierRequired: "请输入邮箱或用户名。",
  invalidCredentials: "邮箱/用户名或密码不正确。",
  invalidRequest: "请求参数无效。",
  loginRequired: "请先登录。",
  passwordRequired: "请输入密码。",
  passwordTooLong: "密码最多不能超过 128 个字符。",
  passwordTooShort: "密码至少需要 6 个字符。",
  usernameInvalid: "用户名只能包含字母、数字和下划线。",
  usernameRequired: "请输入用户名。",
  usernameTooLong: "用户名最多不能超过 32 个字符。",
  usernameTooShort: "用户名至少需要 3 个字符。",
  emailNotActivated: "请先点击邮件中的激活链接，再登录。"
} as const;
