import { createSecretKey, KeyObject } from "node:crypto";

export const createSecretKeyObject = (secret: string): KeyObject => {
  return createSecretKey(Buffer.from(secret));
};
