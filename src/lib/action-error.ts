export type ActionErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_ZDR_UNAVAILABLE"
  | "BAD_REQUEST"
  | "GENERATION_FAILED"
  | "INTERNAL_ERROR"
  | "MAINTENANCE";

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
