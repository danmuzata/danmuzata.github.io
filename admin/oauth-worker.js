/**
 * GitHub OAuth relay for Decap CMS, deployed as a Cloudflare Worker.
 *
 * Decap CMS's admin UI (admin/index.html) can't talk to GitHub's OAuth API
 * directly from the browser, because completing the login requires a client
 * secret that must never be exposed client-side. This Worker is the small
 * server-side piece that holds that secret and does the exchange — it's the
 * `base_url` referenced in admin/config.yml.
 *
 * Deploy steps: see admin/README.md.
 *
 * Required Worker secrets (set via `wrangler secret put`, never committed):
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth") {
      return handleAuth(url, env);
    }
    if (url.pathname === "/callback") {
      return handleCallback(url, env);
    }
    return new Response("Not found", { status: 404 });
  },
};

function handleAuth(url, env) {
  const state = crypto.randomUUID();
  const redirectUri = `${url.origin}/callback`;

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
  githubAuthUrl.searchParams.set("scope", "repo,user");
  githubAuthUrl.searchParams.set("state", state);

  const headers = new Headers({ Location: githubAuthUrl.toString() });
  headers.append(
    "Set-Cookie",
    `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
  );

  return new Response(null, { status: 302, headers });
}

async function handleCallback(url, env) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieHeader = url.searchParams.get("__cookie_fallback") || "";

  if (!code) {
    return htmlResponse(renderError("Missing authorization code from GitHub."));
  }

  const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/callback`,
      state,
    }),
  });

  const tokenData = await tokenResp.json();

  if (tokenData.error || !tokenData.access_token) {
    return htmlResponse(
      renderError(tokenData.error_description || "GitHub did not return an access token.")
    );
  }

  return htmlResponse(renderSuccess(tokenData.access_token));
}

function renderSuccess(token) {
  const payload = JSON.stringify({ token, provider: "github" });
  return `<!DOCTYPE html><html><body>
<script>
(function() {
  function receiveMessage() {
    window.opener.postMessage(
      'authorization:github:success:${payload.replace(/'/g, "\\'")}',
      '*'
    );
    window.removeEventListener('message', receiveMessage, false);
  }
  window.addEventListener('message', receiveMessage, false);
  window.opener.postMessage('authorizing:github', '*');
})();
</script>
<p>Signed in — you can close this window.</p>
</body></html>`;
}

function renderError(message) {
  const safe = message.replace(/</g, "&lt;");
  return `<!DOCTYPE html><html><body>
<script>
window.opener && window.opener.postMessage(
  'authorization:github:error:${JSON.stringify({ message }).replace(/'/g, "\\'")}',
  '*'
);
</script>
<p>Sign-in failed: ${safe}</p>
</body></html>`;
}

function htmlResponse(body) {
  return new Response(body, { headers: { "Content-Type": "text/html" } });
}
