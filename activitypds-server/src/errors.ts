import { z } from "zod";
import { Exception } from "@poppinss/exception";

export const errorResult = z.object({
  status: z.number(),
  error: z.string().optional(),
  message: z.string().optional(),
  credentials: z.never(),
});
export type ErrorResult = z.infer<typeof errorResult>;

export function isErrorResult(v: unknown): v is ErrorResult {
  return errorResult.safeParse(v).success;
}

export function excludeErrorResult<V>(v: V) {
  if (isErrorResult(v)) throw v;
  return v as Exclude<V, ErrorResult>;
}

export class AuthRequiredError extends Exception {
  static code = "E_AUTH_REQUIRED";
  static status = 401;
  static message = "This resource requires authentication";
}

export class InvalidRequestError extends Exception {
  static code = "E_INVALID_REQUEST";
  static status = 400;
  static message = "Invalid request";
}
