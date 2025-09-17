import { HcaptchaConfig } from "@atproto/oauth-provider";
import { BrandingInput } from "@atproto/oauth-provider";

export type ServerSecrets = {
  dpopSecret?: string;
  jwtSecret: string;
};

export type ServerConfig = {
  service: ServiceConfig;
  db: DatabaseConfig;
  fetch: FetchConfig;
  oauth: OAuthConfig;
  invites: InvitesConfig;
};

export type ServiceConfig = {
  port: number;
  hostname: string;
  publicUrl: string;
  version?: string;
  privacyPolicyUrl?: string;
  termsOfServiceUrl?: string;
  contactEmailAddress?: string;
  devMode: boolean;
  handleDomains: string[];
};

export type DatabaseConfig = {
  location: string;
};

export type FetchConfig = {
  disableSsrfProtection: boolean;
  maxResponseSize: number;
};

export type OAuthConfig = {
  issuer: string;
  provider?: {
    hcaptcha?: HcaptchaConfig;
    branding: BrandingInput;
    trustedClients?: string[];
  };
};

export type InvitesConfig = {
  required: boolean;
};
