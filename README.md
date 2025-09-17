# ActivityPDS

This is an example of using the `@atproto/oauth-provider` to make something new.

## License Notice

This repository is source-available code, but it is **unlicensed**, that means you can see how I've done things, but you cannot deploy it anywhere, nor can you use this code verbatim (and you probably shouldn't).

Why? This is a prototype, and uses some MIT/Apache licensed code, and I've just not figured out the license going forwards.

## Running this all

You probably won't be able to, unless you have two domain names that have the DNS of `A 127.0.0.1` pointing for both the root of the domain and all subdomains.

The `example-app` needs to run on a `https://<domain>` that is different to the domain used by the `activitypds-server`. You'd also need to add the caddy intermediate and root certificates to the system CA store, because node.js and custom CA certificates still kinda sucks.