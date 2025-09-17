import events from "node:events";
import type http from "node:http";
import express, { type Express } from "express";
import pino from "pino";
import type { OAuthClient } from "@atproto/oauth-client-node";

import { createDb, migrateToLatest } from "#/db";
import { env } from "#/lib/env";
import { createRouter } from "#/routes";
import { createClient } from "#/auth/client";
import type { Database } from "#/db";
import pinoHttp from "pino-http";

// Application state passed to the router and elsewhere
export type AppContext = {
  service: {
    url: string;
  };
  db: Database;
  logger: pino.Logger;
  oauthClient: OAuthClient;
  pds: {
    url: string;
  };
};

export class Server {
  constructor(
    public app: express.Application,
    public server: http.Server,
    public ctx: AppContext
  ) {}

  static async create() {
    const { NODE_ENV, HOST, PORT, PUBLIC_URL, DB_PATH, PDS_URL } = env;
    const logger = pino({ name: "server start" });

    // Set up the SQLite database
    const db = createDb(DB_PATH);
    await migrateToLatest(db);

    const ctx = {
      db,
      logger,
      service: {
        url: PUBLIC_URL,
      },
      pds: {
        url: PDS_URL,
      },
    };
    // Create the atproto utilities
    const oauthClient = await createClient(ctx);
    const fullCtx = {
      ...ctx,
      oauthClient,
    };

    // Create our server
    const app: Express = express();
    app.set("trust proxy", true);

    // Routes & middlewares
    const router = createRouter(fullCtx);
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(router);
    app.use((_req, res) => res.sendStatus(404));

    // Bind our server to the port
    const server = app.listen(env.PORT);
    await events.once(server, "listening");
    logger.info(
      `Server (${NODE_ENV}) running on port ${
        PUBLIC_URL ? PUBLIC_URL : `http://${HOST}:${PORT}`
      }`
    );

    return new Server(app, server, fullCtx);
  }

  async close() {
    this.ctx.logger.info("sigint received, shutting down");
    return new Promise<void>((resolve) => {
      this.server.close(() => {
        this.ctx.logger.info("server closed");
        resolve();
      });
    });
  }
}

const run = async () => {
  const server = await Server.create();

  const onCloseSignal = async () => {
    setTimeout(() => process.exit(1), 10000).unref(); // Force shutdown after 10s
    await server.close();
    process.exit();
  };

  process.on("SIGINT", onCloseSignal);
  process.on("SIGTERM", onCloseSignal);
};

run();
