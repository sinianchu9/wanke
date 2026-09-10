export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const e = error as any;
    const code = String(e.code || e.Code || e.data?.Code || e.data?.code || "").trim();
    const requestId = String(e.requestId || e.RequestId || e.data?.RequestId || e.data?.requestId || "").trim();
    const status = Number(e.statusCode || e.status || e.httpCode || 0);
    const rawMessage = String(error.message || error).trim();

    // 记录详细开发者日志（遵循规则 9.2：用户展示与后台日志严格分离）
    console.error("[Backend Error]", {
      code,
      requestId,
      status,
      message: rawMessage,
      stack: error.stack,
    });

    // 针对常见云端凭证/服务错误提供三层人性化文案（遵循规则 2.1 与 2.2）
    const normalizedCode = code.toLowerCase();
    const haystack = `${code} ${rawMessage}`.toLowerCase();

    if (normalizedCode === "invalidaccesskeyid.inactive" || haystack.includes("specified access key is disabled")) {
      return "素材服务凭证已停用：配置的阿里云 AccessKey 在云控制台处于禁用状态。如需使用扩展素材库，请在阿里云 RAM 控制台重新启用该 Key 或更换新密钥；若仅使用百炼进行视频生成，可在系统设置中清除该密钥直接在“AI 视频”选择本地图片。";
    }
    if (normalizedCode === "invalidaccesskeyid.notfound" || normalizedCode === "invalidaccesskeyid") {
      return "素材服务凭证无效：配置的阿里云 AccessKey ID 不存在。请在系统设置中核对并填入正确的 AccessKey ID 与 Secret。";
    }
    if (normalizedCode === "signaturedoesnotmatch") {
      return "素材服务签名校验失败：AccessKey Secret 不正确。请在系统设置中重新填写该密钥的 Secret。";
    }
    if (normalizedCode === "nopermission" || normalizedCode === "accessdenied" || haystack.includes("accessdenied")) {
      return "素材服务权限不足：当前 AccessKey 未被授予一刻或素材管理相关权限。请在阿里云 RAM 访问控制中为该用户添加相应权限策略。";
    }
    if (normalizedCode === "throttling" || normalizedCode === "requestthrottled" || status === 429) {
      return "服务请求过于频繁：触发了云端接口并发频率限制。请稍等片刻后重试操作。";
    }
    if (haystack.includes("econnrefused") || haystack.includes("enotfound") || haystack.includes("etimedout")) {
      return "网络连接异常：无法连接至云端服务。请检查网络状态或服务器出网配置，然后重试。";
    }

    // 过滤可能残留的技术性代码与括号，避免直接把原始后端信息暴露给用户
    const cleanMsg = rawMessage
      .replace(/\[[a-zA-Z0-9._-]+\]\s*/g, "")
      .replace(/code:\s*\d+,?\s*/gi, "")
      .replace(/request\s*id:\s*[a-zA-Z0-9-]+/gi, "")
      .replace(/\(HTTP\s*\d+\)/gi, "")
      .replace(/\(RequestId\s*[a-zA-Z0-9-]+\)/gi, "")
      .trim();

    return cleanMsg || "操作未能成功完成：服务响应异常，请稍后重试。";
  }

  if (error && typeof error === "object") {
    console.error("[Backend Error Object]", error);
    const e = error as any;
    const msg = String(e.message || e.Message || "").trim();
    return msg || "操作未能成功完成，请稍后重试。";
  }

  return String(error || "操作未能成功完成，请稍后重试。");
}
