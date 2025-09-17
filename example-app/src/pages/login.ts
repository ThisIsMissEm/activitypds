import { html } from "../lib/view";
import { shell } from "./shell";

type Props = { error?: string; pds_url: string };

export function login(props: Props) {
  return shell({
    title: "Log in",
    content: content(props),
  });
}

function content({ error, pds_url }: Props) {
  return html`<div id="root">
    <div id="header">
      <h1>Example App</h1>
      <h5>Do something with ActivityPDS.</h5>
    </div>
    <div class="container">
      ${error
        ? html`<p class="error visible">Error: <i>${error}</i></p>`
        : undefined}
      <form action="/login" method="post" class="login-form">
        <input
          type="text"
          name="handle"
          placeholder="Enter your handle (eg alice.bsky.social)"
          required
        />
        <button type="submit">Log in</button>
      </form>

      <div class="signup-cta">Don't have an account on the ActivityPub?</div>
      <form action="/signup" method="post" class="login-form">
        <input type="text" name="pds" value="${pds_url}" required />
        <button type="submit">Sign up</button>
      </form>
    </div>
  </div>`;
}
