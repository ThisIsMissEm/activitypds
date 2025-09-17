// Lifted from PDS

import crypto from "node:crypto";

export const NEW_PASSWORD_MAX_LENGTH = 256;

export const genSaltAndHash = (password: string): Promise<string> => {
  const salt = crypto.randomBytes(16).toString("hex");
  return hashWithSalt(password, salt);
};

export const hashWithSalt = (
  password: string,
  salt: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, hash) => {
      if (err) return reject(err);
      resolve(salt + ":" + hash.toString("hex"));
    });
  });
};

export const verify = async (
  password: string,
  storedHash: string
): Promise<boolean> => {
  const [salt, hash] = storedHash.split(":");
  const derivedHash = await getDerivedHash(password, salt);
  return hash === derivedHash;
};

export const getDerivedHash = (
  password: string,
  salt: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedHash) => {
      if (err) return reject(err);
      resolve(derivedHash.toString("hex"));
    });
  });
};
