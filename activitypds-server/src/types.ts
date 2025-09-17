import { Awaitable } from "@atproto/oauth-provider";
import express from "express";
import { ErrorResult } from "./errors";

export type Simplify<T> = {
  [K in keyof T]: T[K];
} & NonNullable<unknown>;

export type WithRequired<T, K extends keyof T> = Simplify<
  Omit<T, K> & Required<Pick<T, K>>
>;

// AuthVerifier:
export type AuthResult = {
  credentials: unknown;
  artifacts?: unknown;
};

export type AuthVerifier<C, A extends AuthResult = AuthResult> =
  | ((ctx: C) => Awaitable<A | ErrorResult>)
  | ((ctx: C) => Awaitable<A>);

export type Primitive = string | number | boolean;
export type Params = { [P in string]?: undefined | Primitive | Primitive[] };

export type MethodAuthContext<P extends Params = Params> = {
  params: P;
  req: express.Request;
  res: express.Response;
};

export type MethodAuthVerifier<
  A extends AuthResult = AuthResult,
  P extends Params = Params
> = AuthVerifier<MethodAuthContext<P>, A>;

export type AuthorizedOptions<P extends Params = Params> = {
  authorize: (
    permissions: string[],
    ctx: MethodAuthContext<P>
  ) => Awaitable<void>;
};
