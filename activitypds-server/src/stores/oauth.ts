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
  private accountDevices: SimpleKV;
  private authorizedClients: SimpleKV;
  private authorizationRequests: SimpleKV;
  private devices: SimpleKV;
  private tokens: SimpleKV;

  constructor(
    private readonly accountManager: AccountManager,
    private readonly db: Database,
    private readonly publicUrl: string
  ) {
    this.accountDevices = new SimpleKV(this.db, "account_devices");
    this.authorizedClients = new SimpleKV(this.db, "authorized_clients");
    this.authorizationRequests = new SimpleKV(this.db, "authorization_request");
    this.devices = new SimpleKV(this.db, "devices");
    this.tokens = new SimpleKV(this.db, "tokens");
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
    if (refreshToken) {
      await this.tokens.putMapping("refresh_token", refreshToken, tokenId);
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
    await this.tokens.remove(tokenId);
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

    await this.tokens.put(newTokenId, merge(token, newData));
    await this.tokens.putMapping("refresh_token", newRefreshToken, newTokenId);
  }

  async findTokenByRefreshToken(
    refreshToken: RefreshToken
  ): Promise<null | TokenInfo> {
    const tokenId = await this.tokens.getMapping("refresh_token", refreshToken);
    oauthLogger.info({ tokenId, refreshToken }, "findTokenByRefreshToken");

    if (!tokenId) return null;
    const tokenData = await this.tokens.getMapping(tokenId.value);
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
      id: tokenId.value as TokenId,
      data: token,
      account: account.account,
      currentRefreshToken: refreshToken,
    };
  }

  async findTokenByCode(code: Code): Promise<null | TokenInfo> {
    notImplemented();
  }

  async listAccountTokens(sub: Sub): Promise<TokenInfo[]> {
    notImplemented();
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
    await Promise.all([
      this.authorizedClients.put(clientId, data),
      this.authorizedClients.putMapping("sub_to_client", sub, clientId),
    ]);
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
    const authorizedClientIds = await this.authorizedClients.getMapping(
      "sub_to_client",
      sub
    );

    const results = new Map();
    if (!authorizedClientIds) {
      return results;
    }

    const authorizedClientId = authorizedClientIds.value;
    const authorizedClient = await this.authorizedClients.getMapping(
      authorizedClientId
    );
    if (!authorizedClient) {
      return results;
    }

    const authorizedClientData = fromJson<AuthorizedClientData>(
      authorizedClient.value as JsonEncoded<AuthorizedClientData>
    );

    results.set(authorizedClientId, authorizedClientData);

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
    const handle = this.subToHandle(sub);
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

    oauthLogger.info(
      { account, sub, handle, deviceAccountIds },
      "getDeviceAccount"
    );

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
    // not implemented
  }

  async listDeviceAccounts(
    filter: { sub: Sub; deviceId: never } | { sub: never; deviceId: DeviceId }
  ): Promise<DeviceAccount[]> {
    oauthLogger.info({ filter }, "listDeviceAccounts");
    const results: DeviceAccount[] = [];
    if (filter.sub) {
      // not implemented
    }

    if (filter.deviceId) {
      const deviceId = filter.deviceId;
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
      const newData = existing
        ? merge({}, fromJson(existing.value as JsonEncoded<RequestData>), data)
        : data;

      await this.put(requestId, newData);
      if (newData.code) {
        await this.putMapping("authorization_code", newData.code, requestId);
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
    const requestId = await this.authorizationRequests
      .removeQuery(this.db, `authorization_code:${code}`)
      .executeTakeFirst();

    if (!requestId) return null;

    const request = await this.authorizationRequests.remove(
      requestId.value,
      false
    );

    if (!request) return null;

    return {
      requestId: requestId.value as RequestId,
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
