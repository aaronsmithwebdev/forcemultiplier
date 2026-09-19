export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function publicError(error: unknown) {
  if (error instanceof AppError)
    return { error: error.message, status: error.status };
  if (error instanceof Error && error.name === "ZodError")
    return {
      error: "Check the required fields and their formats.",
      status: 400,
    };
  return {
    error:
      "This request could not finish. Check your connection and try again.",
    status: 500,
  };
}
