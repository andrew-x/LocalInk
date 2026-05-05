export type ActionErrorCode = "BAD_REQUEST" | "MAINTENANCE" | "INTERNAL_ERROR";

export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly publicMessage: string;

  constructor(code: ActionErrorCode, publicMessage: string) {
    super(publicMessage);
    this.name = "ActionError";
    this.code = code;
    this.publicMessage = publicMessage;
  }
}
