import { html } from "../lib/view";
import { shell } from "./shell";

type Props = { url: string; result: Record<string, any> };

export function debug(props: Props) {
  return shell({
    title: "Log in",
    content: content(props),
  });
}

function content({ url, result }: Props) {
  return html`<div id="root">
    <div id="header">
      <h1>Example App</h1>
      <h5>Do something with ActivityPDS.</h5>
    </div>
    <div class="container">
      <p>Requested: <code>${url}</code></p>
      <pre><code>${JSON.stringify(result, null, 2)}</code></pre>
      <form action="/logout" method="post" class="login-form">
        <button type="submit">Log out</button>
      </form>
    </div>
  </div>`;
}
