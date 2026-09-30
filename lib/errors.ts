export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const transientCodes = new Set([
  "P1001",
  "P1002",
  "P1017",
  "P2024",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);
export function transientError(error: unknown) {
  const value = error as {
    name?: unknown;
    code?: unknown;
    cause?: { code?: unknown };
  };
  return (
    [value?.code, value?.cause?.code].some((code) =>
      transientCodes.has(String(code)),
    ) || ["AbortError", "TimeoutError"].includes(String(value?.name))
  );
}
export function publicError(error: unknown) {
  if (error instanceof AppError)
    return { error: error.message, status: error.status };
  if (error instanceof Error && error.name === "ZodError")
    return {
      error: "Check the required fields and their formats.",
      status: 400,
    };
  if (transientError(error))
    return {
      error:
        "A temporary database or network interruption stopped this request. Try again to continue from the last saved step.",
      status: 503,
    };
  return {
    error:
      "This request could not finish. Check your connection and try again.",
    status: 500,
  };
}
