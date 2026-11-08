# Ollama on the Windows laptop

Use the laptop's Ollama as Dawnstudy's first model, with the configured Gemini models next. These files are a setup reference for the Windows server folder `C:\Users\daqui\OneDrive\Documents\Dawnstudy Server`. The repo itself cannot write to that Windows path from the Linux development workspace.

## Hardware and concurrency

Start with Ollama's `qwen3:4b` model. Its quantized 4B size is a practical starting point for an RTX 3050 Ti laptop with 16 GB system RAM; larger models may spill to system memory and become too slow. Confirm actual GPU placement with `ollama ps` and available VRAM with `nvidia-smi`.

Dawnstudy defaults to one Ollama request at a time and uses a short source window for each batch. The API accepts up to six active generation jobs and runs two generation workers; a job that encounters a busy Ollama slot immediately proceeds to its next configured provider instead of queueing another GPU inference. Do not raise `OLLAMA_MAX_CONCURRENT_REQUESTS` above `1` on this laptop unless measured GPU/RAM headroom supports it. The setting is capped at 10.

## Install and prepare Ollama

In PowerShell, install Ollama if it is not already installed, then pull the model:

```powershell
winget install --id Ollama.Ollama --exact
ollama pull qwen3:4b
ollama list
```

Set a single parallel request and a 4096-token context for the local server. Quit and restart Ollama after setting the user-level variables so the running server inherits them:

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_NUM_PARALLEL", "1", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_CONTEXT_LENGTH", "8192", "User")
```

Ollama should listen only on `127.0.0.1:11434`; do not bind it to `0.0.0.0` or open port 11434 on the router/firewall. Check it locally:

```powershell
ollama ps
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

For Dawnstudy's backend running on the same laptop, use `OLLAMA_BASE_URL=http://127.0.0.1:11434/v1`. Production Render cannot reach the laptop's loopback address, so use the protected Cloudflare Tunnel setup below.

## Free temporary connection (no domain)

A Cloudflare Quick Tunnel provides a temporary `trycloudflare.com` hostname without buying or owning a domain. It is intended for development/testing, not reliable production hosting: the URL changes when the tunnel restarts, so update Render's `OLLAMA_BASE_URL` each time. Laptop sleep, power loss, network changes, and tunnel outages make Ollama unavailable; Dawnstudy should then continue through its configured cloud providers.

**Never point a public tunnel directly at port 11434.** Ollama does not authenticate its API. Run the included proxy, which listens only on `127.0.0.1:8787`, requires a shared bearer key, allows only chat-completion requests, limits request size, and permits one in-flight request. Do not configure Access headers for a Quick Tunnel.

1. Copy `proxy.py` into `C:\Users\daqui\OneDrive\Documents\Dawnstudy Server`. Keep the script and any local configuration private; do not put a real key in the repository.
2. In PowerShell, generate a random secret, save it in your Windows user environment, and copy it to the clipboard. Paste it into Render's `OLLAMA_API_KEY` environment variable (do not paste it into chat or a source file):

   ```powershell
   $key = python -c "import secrets; print(secrets.token_urlsafe(32))"
   [Environment]::SetEnvironmentVariable("OLLAMA_API_KEY", $key, "User")
   $env:OLLAMA_API_KEY = $key
   Set-Clipboard -Value $key
   Write-Host "Secret copied to clipboard. Paste it into Render as OLLAMA_API_KEY."
   ```

3. Ensure Ollama is running with `qwen3:4b` installed. In the same PowerShell window, start the proxy and leave that window open:

   ```powershell
   cd "C:\Users\daqui\OneDrive\Documents\Dawnstudy Server"
   python .\proxy.py
   ```

   In another PowerShell window, confirm the local proxy responds:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:8787/health
   ```

4. Install `cloudflared` if needed, then create the temporary tunnel to the proxy (not Ollama):

   ```powershell
   winget install --id Cloudflare.cloudflared --exact
   cloudflared tunnel --url http://127.0.0.1:8787
   ```

   Keep this window open. Copy the generated `https://....trycloudflare.com` URL from its output.

5. In **Render → dawnstudy-api → Environment**, set:

   | Variable | Value |
   | --- | --- |
   | `OLLAMA_BASE_URL` | `https://<generated-host>.trycloudflare.com/v1` |
   | `OLLAMA_MODEL` | `qwen3:4b` |
   | `OLLAMA_MAX_CONCURRENT_REQUESTS` | `1` |
   | `OLLAMA_API_KEY` | The generated secret copied from the clipboard |
   | `OLLAMA_ACCESS_CLIENT_ID` / `OLLAMA_ACCESS_CLIENT_SECRET` | Leave empty |

   Save the environment changes and deploy/restart the Render service. Keep the laptop awake and both PowerShell windows running while testing. When `cloudflared` gives you a different URL after a restart, update Render's `OLLAMA_BASE_URL`.

The shared key protects the proxy route; it does not make Quick Tunnels a stable or production-grade service. Do not use this workaround for sensitive source material or rely on it for guaranteed generation. The Gemini and other configured providers remain necessary fallbacks.

## Publish securely through Cloudflare

This requires a domain managed in Cloudflare. Do not expose Ollama directly to the internet: its local OpenAI-compatible endpoint has no user authentication. The tunnel must be protected by a Cloudflare Access application and a **Service Auth** policy.

1. Install `cloudflared` and authenticate it to your Cloudflare account:

   ```powershell
   winget install --id Cloudflare.cloudflared --exact
   cloudflared tunnel login
   cloudflared tunnel create dawnstudy-ollama
   ```

   Save the tunnel UUID printed by the command. Its credential JSON belongs under `%USERPROFILE%\.cloudflared`; keep it out of OneDrive, Git, and chat.

2. Create the public hostname route, replacing `ollama.yourdomain.com` with a hostname in your Cloudflare-managed domain:

   ```powershell
   cloudflared tunnel route dns dawnstudy-ollama ollama.yourdomain.com
   ```

3. Copy `config.example.yml` to `%USERPROFILE%\.cloudflared\config.yml`. Replace `REPLACE_WITH_TUNNEL_UUID` in both locations and set the real hostname. Keep the `service` at `http://127.0.0.1:11434`.

4. In Cloudflare Zero Trust, create a **self-hosted** Access application for exactly that hostname. Add a policy with action **Service Auth** and include a newly created **Service Token**. Do not add an `Allow everyone` policy. Copy the generated client ID and secret directly into Render; do not put them in the config, repository, or frontend.

5. Start the tunnel in a PowerShell window and leave it running while the laptop is available:

   ```powershell
   cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\config.yml" run
   ```

   Check only that Access blocks unauthenticated requests. Do not test a browser visit as proof of the service-token route; Dawnstudy sends the token in request headers.

## Configure Render

In **Render → dawnstudy-api → Environment**, set:

| Variable | Value |
| --- | --- |
| `OLLAMA_BASE_URL` | `https://ollama.yourdomain.com/v1` |
| `OLLAMA_MODEL` | `qwen3:4b` |
| `OLLAMA_MAX_CONCURRENT_REQUESTS` | `1` |
| `OLLAMA_ACCESS_CLIENT_ID` | Cloudflare Access Service Token client ID |
| `OLLAMA_ACCESS_CLIENT_SECRET` | Cloudflare Access Service Token secret |
| `OLLAMA_API_KEY` | Leave empty when using Cloudflare Access directly |

Keep the Gemini key configured as well. The model order is Ollama first, then Gemini 2.5 Flash-Lite, 2.5 Flash, 3.1 Flash-Lite, 3.5 Flash-Lite, 3.6 Flash, and 3.8 Flash when each is listed and available to the Google API key; other configured providers follow. Gemini 2.5 Flash is deprecated/restricted and may not be enabled for new accounts. If either 2.5 model returns an access error, Dawnstudy skips that model and still tries later Gemini models. Provider model availability and quotas can change; a configured fallback is not a guarantee of upstream capacity.

Deploy the API after setting the variables. If the laptop is off, Ollama or the tunnel is not running, or its single request slot is occupied, the request fails over to Gemini without waiting for the local slot. Render can process up to six active generation jobs at once; additional jobs receive the existing capacity response rather than accumulating without limit.
