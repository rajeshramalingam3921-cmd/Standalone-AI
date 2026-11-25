# Using Thiran AI from your iPhone

The server only listens on `127.0.0.1` (your PC). To reach it from the iPhone **without
exposing it to the internet**, use a private network. These steps use **Tailscale**; any
private VPN that gives you HTTPS works the same way.

> ⚠️ Not yet verified end-to-end on a real iPhone. Check `tailscale serve --help` on your
> version, the command syntax has changed between releases.

## 1. Private network

1. Install Tailscale on the Windows PC and on the iPhone; sign in with the same account.
2. In the Tailscale admin console enable **MagicDNS** and **HTTPS certificates**.
3. On the PC: `tailscale serve --bg 4000`
   This publishes `https://<machine>.<tailnet>.ts.net` **inside your tailnet only**,
   forwarding to `http://127.0.0.1:4000`.

**Never use `tailscale funnel`** (it puts the server on the public internet).

## 2. Tell Thiran AI about it (`.env`)

```dotenv
NODE_ENV=production
COOKIE_SECURE=true           # session cookie only over HTTPS
TRUST_PROXY=true             # trust the local Tailscale proxy for client IPs (audit, rate limits)
ALLOWED_HOSTS=127.0.0.1,localhost,::1,<machine>.<tailnet>.ts.net
```

Restart the server. Requests for any other host name are refused: the page then shows
"Server பதில்: HTTP 421" — add the exact name you typed to `ALLOWED_HOSTS`.

## 3. On the iPhone

1. Open Safari → `https://<machine>.<tailnet>.ts.net` → sign in.
2. Share → **Add to Home Screen**. Thiran AI then opens full-screen like an app.
   iOS keeps Home-Screen apps' storage separate from Safari, so you sign in once more inside
   the Home-Screen app.
3. Let iOS Keychain save the password if you like (the login form supports it).

## Safety checklist

- [ ] Server `HOST=127.0.0.1` (not `0.0.0.0`).
- [ ] No router port forwarding; no Tailscale Funnel.
- [ ] `COOKIE_SECURE=true`, strong owner password (`pnpm set-password`).
- [ ] Lost phone? Run `pnpm set-password` on the PC: it signs out every session. Remove the
      device in the Tailscale admin console.
