process.env.LOG_SYSTEMS = "";

import { ServerConfig, ServerSecrets } from "./config";
import { httpLogger } from "./logger";
import ActivityPDS from "./server";

const config: ServerConfig = {
  service: {
    port: 8080,
    hostname: "activitypds.princess.works",
    publicUrl: "https://activitypds.princess.works",
    devMode: true,
    handleDomains: [".princess.works", ".activitypds.example"],
    requiredSecondFactor: true,
  },
  db: {
    location: "../db.sqlite",
  },
  invites: {
    required: false,
  },
  fetch: {
    disableSsrfProtection: false,
    maxResponseSize: Infinity,
  },
  oauth: {
    issuer: "https://activitypds.princess.works",
    provider: {
      branding: {
        name: "ActivityPDS",
      },
      trustedClients: [],
    },
  },
};

const secrets: ServerSecrets = {
  jwtSecret: "07657d9b5a527a328571dbe51763986a",
  dpopSecret:
    "e7fef56348a5ae6470de465c4ee10f36d28711d1d78f1fa9d57c865729594134",
};

async function main() {
  const pds = await ActivityPDS.create(config, secrets);
  await pds.start();

  httpLogger.info("pds has started");

  const terminator = async () => {
    httpLogger.info("pds is stopping");
    setTimeout(() => process.exit(1), 10000).unref(); // Force shutdown after 10s
    await pds.destroy();
    httpLogger.info("pds is stopped");
    process.exit();
  };
  // Graceful shutdown (see also https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/)
  process.on("SIGINT", terminator);
  process.on("SIGTERM", terminator);
}

main();
