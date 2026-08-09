export function describeError(error: unknown) {
  if (error instanceof Error) {
    const e = error as any;
    const code = e.code || e.Code || e.data?.Code || e.data?.code;
    const requestId = e.requestId || e.RequestId || e.data?.RequestId || e.data?.requestId;
    const status = e.statusCode || e.status || e.httpCode;
    const pieces = [code ? `[${code}]` : "", error.message || String(error), status ? `(HTTP ${status})` : "", requestId ? `(RequestId ${requestId})` : ""].filter(Boolean);
    return pieces.join(" ");
  }
  if (error && typeof error === "object") {
    const e = error as any;
    return [e.code || e.Code, e.message || e.Message, e.requestId || e.RequestId].filter(Boolean).join(" · ") || JSON.stringify(error);
  }
  return String(error);
}
