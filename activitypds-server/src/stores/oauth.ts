import {
  Account,
  AccountStore,
  AuthenticateAccountData,
  AuthorizedClientData,
  AuthorizedClients,
  ClientId,
  Code,
  CreateAccountData,
  CreateTokenData,
  DeviceAccount,
  DeviceData,
  DeviceId,
  DeviceStore,
  FoundRequestResult,
  HandleUnavailableError,
  InvalidRequestError,
  LexiconData,
  LexiconStore,
  NewTokenData,
  RefreshToken,
  RequestData,
  RequestId,
  RequestStore,
  ResetPasswordConfirmData,
  ResetPasswordRequestData,
  Sub,
  TokenData,
  TokenId,
  TokenInfo,
  TokenStore,
  UpdateRequestData,
} from "@atproto/oauth-provider";

import { merge } from "lodash-es";
import { AccountManager } from "../account-manager";
import { Database } from "../db";
import type * as db from "../db";
import { SimpleKV } from "./simple-kv";
import { fromJson, JsonEncoded } from "../db/cast";
import assert from "node:assert";
import { oauthLogger } from "../logger";
import { DID_WEB_PREFIX } from "../constants";

function notImplemented(): never {
  const error = new Error("Not Implemented");
  console.log(`Not Implemented: ${error.stack}`);
  throw error;
}

export class OAuthStore
  implements AccountStore, RequestStore, DeviceStore, LexiconStore, TokenStore
{
  private accountDevices: SimpleKV<["sub_devices"]>;
  private authorizedClients: SimpleKV<["sub_clients"]>;
  private authorizationRequests: SimpleKV<
    ["authorization_code_requests", "device_requests"]
  >;
  private devices: SimpleKV;
  private tokens: SimpleKV<
    [
      "account_tokens",
      "refresh_token",
      "authorization_code",
      "device_tokens",
      "token_device"
    ]
  >;

  constructor(
    private readonly accountManager: AccountManager,
    private readonly db: Database,
    private readonly publicUrl: string
  ) {
    this.accountDevices = new SimpleKV(this.db, "account_devices", [
      "sub_devices",
    ]);
    this.authorizedClients = new SimpleKV(this.db, "authorized_clients", [
      "sub_clients",
    ]);
    this.authorizationRequests = new SimpleKV(
      this.db,
      "authorization_request",
      ["authorization_code_requests", "device_requests"]
    );
    this.devices = new SimpleKV(this.db, "devices");
    this.tokens = new SimpleKV(this.db, "tokens", [
      "account_tokens",
      "refresh_token",
    ]);
  }

  //
  // TokenStore
  //
  async createToken(
    tokenId: TokenId,
    data: CreateTokenData,
    refreshToken?: RefreshToken
  ): Promise<void> {
    await this.tokens.put(tokenId, data);

    const tokens = await this.tokens.getMultiMapping<TokenId>(
      "account_tokens",
      data.sub
    );
    if (tokens) {
      await this.tokens.putMapping(
        "account_tokens",
        data.sub,
        tokens.concat([tokenId])
      );
    } else {
      await this.tokens.putMapping("account_tokens", data.sub, [tokenId]);
    }

    if (data.deviceId) {
      await this.tokens.putMapping("token_device", tokenId, data.deviceId);
      const tokens = await this.tokens.getMultiMapping<TokenId>(
        "device_tokens",
        data.deviceId
      );
      if (tokens) {
        await this.tokens.putMapping(
          "device_tokens",
          data.deviceId,
          tokens.concat([tokenId])
        );
      } else {
        await this.tokens.putMapping("device_tokens", data.deviceId, [tokenId]);
      }
    }

    if (refreshToken) {
      await this.tokens.putMapping("refresh_token", refreshToken, tokenId);
    }
    if (data.code) {
      await this.tokens.putMapping("authorization_code", data.code, tokenId);
    }
  }

  async readToken(tokenId: TokenId): Promise<null | TokenInfo> {
    const tokenData = await this.tokens.get(tokenId);
    if (!tokenData) return null;
    const token = fromJson<TokenData>(
      tokenData.value as JsonEncoded<TokenData>
    );
    const account = await this.getAccount(token.sub);

    if (!account) {
      return null;
    }

    return {
      id: tokenId as TokenId,
      data: token,
      account: account.account,
      currentRefreshToken: null,
    };
  }

  async deleteToken(tokenId: TokenId): Promise<void> {
    const tokenData = await this.tokens.get(tokenId);
    oauthLogger.info({ tokenId }, "deleteToken");
    if (!tokenData) return;
    const token = fromJson<TokenData>(
      tokenData.value as JsonEncoded<TokenData>
    );

    if (token.code) {
      await this.tokens.removeMapping("authorization_code", token.code);
    }

    await this.tokens.remove(tokenId);
    const refreshTokens = await this.tokens
      .getLikeQuery(this.db, "refresh_token", tokenId)
      .execute();

    oauthLogger.info({ refreshTokens, tokenId }, "deleteToken refresh tokens");

    await Promise.all(
      refreshTokens.map((token) => this.tokens.remove(token.key, false))
    );

    const tokens = await this.tokens.getMultiMapping<TokenId>(
      "account_tokens",
      token.sub
    );

    if (tokens) {
      const newTokens = tokens.filter((tId) => tId !== tokenId);
      if (newTokens.length) {
        await this.tokens.putMapping("account_tokens", token.sub, newTokens);
      } else {
        await this.tokens.removeMapping("account_tokens", token.sub);
      }
    }

    if (token.deviceId) {
      const deviceTokens = await this.tokens.getMultiMapping<TokenId>(
        "account_tokens",
        token.deviceId
      );

      if (deviceTokens) {
        const newTokens = deviceTokens.filter((tId) => tId !== tokenId);
        if (newTokens.length) {
          await this.tokens.putMapping(
            "device_tokens",
            token.deviceId,
            newTokens
          );
        } else {
          await this.tokens.removeMapping("device_tokens", token.deviceId);
        }
      }
    }

    await this.tokens.removeMapping("token_device", tokenId);
  }

  async rotateToken(
    tokenId: TokenId,
    newTokenId: TokenId,
    newRefreshToken: RefreshToken,
    newData: NewTokenData
  ): Promise<void> {
    const existing = await this.tokens.remove(tokenId);
    if (!existing) {
      // something
      return;
    }

    const token = fromJson<TokenData>(existing.value as JsonEncoded<TokenData>);

    await this.tokens.put(newTokenId, merge(token, newData), newData.expiresAt);
    const deviceId = await this.tokens.removeMapping<DeviceId>(
      "token_device",
      tokenId
    );
    if (deviceId) {
      const deviceTokens = await this.tokens.getMultiMapping<TokenId>(
        "device_tokens",
        deviceId
      );
      if (deviceTokens) {
        await this.tokens.putMapping(
          "device_tokens",
          deviceId,
          deviceTokens.concat([newTokenId])
        );
      } else {
        await this.tokens.putMapping("device_tokens", deviceId, [newTokenId]);
      }
    }

    const tokens = await this.tokens.getMultiMapping<TokenId>(
      "account_tokens",
      token.sub
    );
    if (tokens) {
      const newTokens = tokens
        .filter((id) => id !== tokenId)
        .concat([newTokenId]);
      if (newTokens.length) {
        await this.tokens.putMapping("account_tokens", token.sub, newTokens);
      } else {
        await this.tokens.removeMapping("account_tokens", token.sub);
      }
    } else {
      await this.tokens.putMapping("account_tokens", token.sub, [newTokenId]);
    }

    await this.tokens.putMapping("refresh_token", newRefreshToken, newTokenId);
  }

  async findTokenByRefreshToken(
    refreshToken: RefreshToken
  ): Promise<null | TokenInfo> {
    const tokenId = await this.tokens.getMapping<string>(
      "refresh_token",
      refreshToken
    );
    oauthLogger.info({ tokenId, refreshToken }, "findTokenByRefreshToken");

    if (!tokenId) return null;
    const tokenData = await this.tokens.get(tokenId);
    oauthLogger.info({ tokenData });

    if (!tokenData) return null;

    const token = fromJson<TokenData>(
      tokenData.value as JsonEncoded<TokenData>
    );
    const account = await this.getAccount(token.sub);

    if (!account) {
      return null;
    }

    return {
      id: tokenId as TokenId,
      data: token,
      account: account.account,
      currentRefreshToken: refreshToken,
    };
  }

  async findTokenByCode(code: Code): Promise<null | TokenInfo> {
    oauthLogger.info({ code }, "findTokenByCode");
    notImplemented();
  }

  async listAccountTokens(sub: Sub): Promise<TokenInfo[]> {
    const accountTokens = await this.tokens.getMultiMapping<TokenId>(
      "account_tokens",
      sub
    );
    if (!accountTokens) return [];

    const tokens = await Promise.all(
      accountTokens.map((tokenId) => {
        return this.readToken(tokenId);
      })
    );
    oauthLogger.info({ accountTokens, tokens }, "listAccountTokens");

    return tokens.filter((token) => token !== null);
  }

  //
  // Account Store
  //
  async createAccount({
    email,
    handle,
    password,
  }: CreateAccountData): Promise<Account> {
    await Promise.all([
      this.verifyEmailAvailability(email),
      this.verifyHandleAvailability(handle),
    ]);

    const account = await this.accountManager.createAccount({
      email,
      handle,
      password,
    });

    return this.toAccount(account);
  }

  async authenticateAccount(data: AuthenticateAccountData): Promise<Account> {
    const account = await this.accountManager.login(data);

    return this.toAccount(account);
  }

  async setAuthorizedClient(
    sub: Sub,
    clientId: ClientId,
    data: AuthorizedClientData
  ): Promise<void> {
    oauthLogger.info({ sub, clientId, data }, "setAuthorizedClient");
    await this.authorizedClients.put(clientId, data);
    const existingClients =
      await this.authorizedClients.getMultiMapping<ClientId>(
        "sub_clients",
        sub
      );
    if (existingClients) {
      const clients = Array.from(new Set(existingClients.concat([clientId])));
      await this.authorizedClients.putMapping("sub_clients", sub, clients);
    } else {
      await this.authorizedClients.putMapping("sub_clients", sub, [clientId]);
    }
  }

  async getAccount(
    sub: Sub
  ): Promise<{ account: Account; authorizedClients: AuthorizedClients }> {
    oauthLogger.info({ sub }, "getAccount");

    const handle = this.subToHandle(sub);

    oauthLogger.info({ handle }, "getAccountWithHandle");
    const account = await this.accountManager.getAccount(handle);

    assert(account, `Account not found: ${handle}`);

    const authorizedClients = await this.getAuthorizedClients(sub);

    return {
      account: this.toAccount(account),
      authorizedClients: authorizedClients,
    };
  }

  async getAuthorizedClients(sub: Sub): Promise<AuthorizedClients> {
    const authorizedClientIds =
      await this.authorizedClients.getMultiMapping<ClientId>(
        "sub_clients",
        sub
      );

    oauthLogger.info({ authorizedClientIds }, "getAuthorizedClients");

    const results = new Map();
    if (!authorizedClientIds) {
      return results;
    }

    oauthLogger.info({ authorizedClientIds }, "getAuthorizedClients");
    await Promise.all(
      authorizedClientIds.map(async (clientId) => {
        const client = await this.authorizedClients.get(clientId);
        if (client) {
          const clientData = fromJson<AuthorizedClientData>(
            client.value as JsonEncoded<AuthorizedClientData>
          );
          results.set(clientId, clientData);
        }
      })
    );

    oauthLogger.info(
      Object.fromEntries(results.entries()),
      "getAuthorizedClients: Results"
    );
    return results;
  }

  async upsertDeviceAccount(deviceId: DeviceId, sub: Sub): Promise<void> {
    oauthLogger.info({ deviceId, sub }, "upsertDeviceAccount");
    return this.accountDevices.transaction(async function () {
      const existing = await this.get(deviceId);
      if (existing) {
        const existingAccounts = new Set(
          fromJson(existing.value as JsonEncoded<string[]>)
        );
        existingAccounts.add(sub);
        const accounts = Array.from(existingAccounts);
        await this.put(deviceId, accounts);

        const existingDevices = await this.getMultiMapping<DeviceId>(
          "sub_devices"
        );
        if (existingDevices) {
          await this.putMapping(
            "sub_devices",
            sub,
            existingDevices.concat([deviceId])
          );
        } else {
          await this.putMapping("sub_devices", sub, [deviceId]);
        }
      } else {
        await this.put(deviceId, [sub]);
      }
    });
  }

  async getDeviceAccount(
    deviceId: DeviceId,
    sub: Sub
  ): Promise<DeviceAccount | null> {
    oauthLogger.info({ deviceId, sub }, "getDeviceAccount");
    const deviceData = await this.readDevice(deviceId);
    const deviceAccounts = await this.accountDevices.get(deviceId);
    const account = await this.getAccount(sub);

    oauthLogger.info(
      { deviceId, sub, deviceData, deviceAccounts, account },
      "getDeviceAccountResults"
    );

    if (!deviceData) {
      return null;
    }

    // fixme: move to helper method like getAll
    const deviceAccountIds = deviceAccounts
      ? fromJson(deviceAccounts.value as JsonEncoded<string[]>)
      : [];

    oauthLogger.info({ account, sub, deviceAccountIds }, "getDeviceAccount");

    if (!deviceAccountIds.includes(sub) || account.account.sub !== sub) {
      return null;
    }

    return {
      account: {
        ...account.account,
        sub: account.account.sub.startsWith(DID_WEB_PREFIX)
          ? sub
          : `${DID_WEB_PREFIX}${account.account.sub}`,
      },
      deviceId: deviceId,
      deviceData: deviceData,
      authorizedClients: account.authorizedClients,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async removeDeviceAccount(deviceId: DeviceId, sub: Sub): Promise<void> {
    oauthLogger.info({ deviceId, sub }, "removeDeviceAccount");
    await this.accountDevices.remove(deviceId);
    await this.accountDevices.removeMultiMapping("sub_devices", sub);

    const tokens = await this.tokens.removeMultiMapping<TokenId>(
      "device_tokens",
      deviceId
    );
    if (tokens) {
      await Promise.all(
        tokens.map(async (tokenId) => {
          await this.deleteToken(tokenId);

          const refreshTokens = await this.tokens
            .getLikeQuery(this.db, "refresh_token", tokenId)
            .execute();

          oauthLogger.info(
            { refreshTokens, tokenId },
            "deleteToken refresh tokens"
          );

          await Promise.all(
            refreshTokens.map((token) => this.tokens.remove(token.key, false))
          );
        })
      );
    }

    oauthLogger.info({ deviceId, sub, tokens }, "deleteToken devices");
  }

  async listDeviceAccounts(
    filter: { sub: Sub; deviceId: never } | { sub: never; deviceId: DeviceId }
  ): Promise<DeviceAccount[]> {
    const results: DeviceAccount[] = [];
    if (filter.sub) {
      const sub = filter.sub;
      const tokenIds = await this.tokens.getMultiMapping<TokenId>(
        "account_tokens",
        sub
      );
      oauthLogger.info({ sub, tokenIds }, "listDeviceAccounts by sub");
      if (tokenIds) {
        const tokens = await Promise.all(
          tokenIds.map((token) => this.readToken(token))
        );

        const accessibleTokens = tokens.filter<TokenInfo>((token) => !!token);

        const devices = new Map<DeviceId, DeviceData>();
        const accountsByToken = new Map<
          TokenId,
          { account: Account; authorizedClients: AuthorizedClients }
        >();
        await Promise.all(
          accessibleTokens.map(async (token) => {
            if (token.data.deviceId) {
              const deviceData = await this.readDevice(token.data.deviceId);
              if (deviceData) {
                devices.set(token.data.deviceId, deviceData);
              }
            }

            accountsByToken.set(
              token.id,
              await this.getAccount(token.account.sub)
            );
          })
        );

        oauthLogger.info({
          tokens,
          devices: Object.fromEntries(devices.entries()),
          accountsByToken: Object.fromEntries(accountsByToken.entries()),
        });

        accessibleTokens.forEach((token) => {
          if (!token.data.deviceId) return;

          const device = devices.get(token.data.deviceId);
          const account = accountsByToken.get(token.id);
          if (!device || !account) return;

          if (account.account.sub !== token.account.sub) {
            oauthLogger.info(
              { tokenSub: token.account.sub, accountSub: account.account.sub },
              "Mismatched subject"
            );
          }

          oauthLogger.info({
            authorizedClients: Object.fromEntries(
              account.authorizedClients.entries()
            ),
          });

          results.push({
            deviceId: token.data.deviceId,
            deviceData: device,
            account: account.account,
            authorizedClients: account.authorizedClients,
            updatedAt: new Date(),
            createdAt: new Date(),
          });
        });
      }
    }

    if (filter.deviceId) {
      const deviceId = filter.deviceId;
      oauthLogger.info({ deviceId }, "listDeviceAccounts by device");
      const deviceData = await this.readDevice(deviceId);
      const deviceAccounts = await this.accountDevices.get(deviceId);
      if (deviceAccounts) {
        const accountIds = fromJson(
          deviceAccounts.value as JsonEncoded<string[]>
        );
        oauthLogger.info({ deviceAccounts, accountIds }, "deviceAccounts");

        const accounts = await Promise.all(
          accountIds.map((accountId) => this.getAccount(accountId))
        );

        accounts.forEach(({ account, authorizedClients }) => {
          if (!deviceId || !deviceData) {
            return;
          }
          results.push({
            deviceId,
            deviceData,
            account,
            authorizedClients,
            updatedAt: new Date(),
            createdAt: new Date(),
          });
        });
      }
    }

    oauthLogger.info({ results }, "listResult");

    return results;
  }

  async resetPasswordRequest(data: ResetPasswordRequestData): Promise<void> {
    notImplemented();
  }

  async resetPasswordConfirm(data: ResetPasswordConfirmData): Promise<void> {
    notImplemented();
  }

  async verifyHandleAvailability(handle: string): Promise<void> {
    if (await this.accountManager.exists({ handle })) {
      throw new HandleUnavailableError("taken");
    }
  }

  async verifyEmailAvailability(email: string): Promise<void> {
    if (await this.accountManager.exists({ email })) {
      throw new InvalidRequestError(`Email already taken`);
    }
  }

  //
  // RequestStore
  //
  async createRequest(
    requestId: RequestId,
    { expiresAt, ...data }: RequestData
  ): Promise<void> {
    oauthLogger.info({ ...data, expiresAt }, "createRequest");
    await this.authorizationRequests.transaction(async function () {
      await this.put(requestId, data, expiresAt);
      if (data.code) {
        await this.putMapping(
          "authorization_code_requests",
          data.code,
          requestId
        );
      }
      if (data.deviceId) {
        await this.putMapping("device_requests", data.deviceId, requestId);
      }
    });
  }

  async readRequest(requestId: RequestId): Promise<RequestData | null> {
    const record = await this.authorizationRequests.get(requestId);
    if (!record) return null;
    return fromJson<RequestData>(record.value as JsonEncoded<RequestData>);
  }

  async updateRequest(
    requestId: RequestId,
    data: UpdateRequestData
  ): Promise<void> {
    oauthLogger.info({ data }, "updateRequest");
    await this.authorizationRequests.transaction(async function () {
      const existing = await this.get(requestId);
      const existingData = existing
        ? fromJson<RequestData>(existing.value as JsonEncoded<RequestData>)
        : null;
      const newData = existing ? merge({}, existingData, data) : data;

      await this.put(requestId, newData);
      if (data.code) {
        await this.putMapping(
          "authorization_code_requests",
          data.code,
          requestId
        );
      }

      if (existingData) {
        if (existingData.deviceId && data.deviceId != existingData.deviceId) {
          await this.removeMapping("device_requests", existingData.deviceId);
        }
        if (existingData.code && data.code != existingData.code) {
          await this.removeMapping(
            "authorization_code_requests",
            existingData.code
          );
        }
      }

      if (data.deviceId) {
        await this.putMapping("device_requests", data.deviceId, requestId);
      }
    });
  }

  async deleteRequest(requestId: RequestId): Promise<void> {
    await this.authorizationRequests.remove(requestId);
  }

  async consumeRequestCode(code: Code): Promise<FoundRequestResult | null> {
    // FIXME: If this throws findTokenByCode is called with the code, and then
    // expects to retrieve the token info, this happens during token replays
    const requestId = await this.authorizationRequests.removeMapping<RequestId>(
      "authorization_code_requests",
      code
    );
    oauthLogger.info({ requestId }, "consumeRequestCode");
    if (!requestId) return null;

    const request = await this.authorizationRequests.remove(requestId);
    oauthLogger.info({ requestId, request }, "consumeRequestCode");
    if (!request) return null;

    return {
      requestId: requestId,
      data: fromJson<RequestData>(request.value as JsonEncoded<RequestData>),
    };
  }

  //
  // DeviceStore
  //
  async createDevice(deviceId: DeviceId, data: DeviceData): Promise<void> {
    await this.devices.put(deviceId, data);
  }

  async readDevice(deviceId: DeviceId): Promise<DeviceData | null> {
    const record = await this.devices.get(deviceId);
    if (!record) return null;
    return fromJson<DeviceData>(record.value as JsonEncoded<DeviceData>);
  }

  async updateDevice(
    deviceId: DeviceId,
    data: Partial<DeviceData>
  ): Promise<void> {
    await this.devices.transaction(async function () {
      const existing = await this.get(deviceId);
      const newData = existing
        ? merge({}, fromJson(existing.value as JsonEncoded<DeviceData>), data)
        : data;

      await this.put(deviceId, newData);
    });
  }

  async deleteDevice(deviceId: DeviceId): Promise<void> {
    oauthLogger.info({ deviceId }, "deleteDevice");
    await this.devices.remove(deviceId);
  }

  //
  // LexiconStore - Not Implemented
  //
  async findLexicon(nsid: string): Promise<LexiconData | null> {
    oauthLogger.info({ nsid }, "findLexicon");
    return null;
  }

  async storeLexicon(nsid: string, data: LexiconData): Promise<void> {
    oauthLogger.info({ nsid, data }, "storeLexicon");
    return;
  }

  async deleteLexicon(nsid: string): Promise<void> {
    oauthLogger.info({ nsid }, "deleteLexicon");
    return;
  }

  private toAccount(account: db.Account): Account {
    return {
      sub: `${DID_WEB_PREFIX}${account.handle}`,
      aud: this.publicUrl,
      email: account.email || undefined,
      email_verified: account.email
        ? account.emailConfirmedAt != null
        : undefined,
      preferred_username: account.handle,
    };
  }

  private subToHandle(sub: Sub): string {
    if (sub.startsWith(DID_WEB_PREFIX)) {
      return sub.slice(DID_WEB_PREFIX.length);
    } else {
      return sub;
    }
  }
}
