# Pushing this site to GitHub — what went wrong and how it was fixed

Written 2026-09-15 after the first push to `danmuzata/danmuzata.github.io`.

## Symptom

`git push origin main` failed, first over HTTPS, then even over SSH once that
was set up — with two different errors along the way:

```
Missing or invalid credentials.
Error: connect ECONNREFUSED /run/user/1017/vscode-git-<hash>.sock
fatal: Authentication failed for 'https://github.com/danmuzata/danmuzata.github.io.git/'
```

and later, after switching to SSH:

```
ERROR: Repository not found.
fatal: Could not read from remote repository.
```

## Root causes (two separate problems)

**1. The HTTPS credential helper was broken in this session.**
This machine's git is set up to authenticate HTTPS pushes through VS Code's
built-in Git credential bridge (`GIT_ASKPASS` pointed at a VS Code askpass
script, which talks to a Unix socket owned by a running VS Code window). In
this particular terminal/session, that socket existed on disk but nothing was
listening on it anymore (the owning VS Code window had gone away without
cleaning up the socket file) — so every credential request failed instantly
with `ECONNREFUSED`, before the request ever reached GitHub.

**2. The GitHub repository hadn't actually been created yet.**
`git remote add origin <url>` (or however `origin` got set) only records a
URL locally — it does not create anything on GitHub's side. The local repo
and its commits were fine the whole time; there was simply no
`danmuzata/danmuzata.github.io` repository on GitHub yet for that URL to
point to. That's why, even after fixing authentication, `git push` /
`git ls-remote` kept returning **"Repository not found"** — that message is
GitHub's genuine response when the name/owner combination doesn't exist (or
isn't visible to the authenticated account), not a network or auth glitch.

A secondary wrinkle: this machine's `ssh`/`ssh-add` picked up a mismatched
OpenSSL from the currently-active `bioatlas` conda environment
(`LD_LIBRARY_PATH` shadowing the system OpenSSL), which produced
`OpenSSL version mismatch` errors until `LD_LIBRARY_PATH` was unset for
those specific commands.

## How it was fixed, step by step

1. Confirmed the HTTPS path was dead (`ECONNREFUSED` on the VS Code socket)
   and switched to SSH instead.
2. Found the existing key at `~/.ssh/id_ed25519` and confirmed it was
   already registered on GitHub (`github.com/settings/keys`), as an
   **Authentication key** (not just a signing key — GitHub distinguishes the
   two, and a signing-only key can't be used to authenticate `git push`).
3. Discovered the key is passphrase-protected, so it can't be used
   non-interactively (`ssh -o BatchMode=yes`) without something to hold the
   decrypted key in memory.
4. Started a dedicated `ssh-agent` on a fixed socket path:
   ```
   ssh-agent -a /tmp/danny-git-ssh-agent.sock
   ```
5. Unlocked the key into that agent interactively (passphrase typed
   directly into the terminal, never sent through chat):
   ```
   env -u LD_LIBRARY_PATH SSH_AUTH_SOCK=/tmp/danny-git-ssh-agent.sock ssh-add ~/.ssh/id_ed25519
   ```
6. Verified SSH auth worked:
   ```
   env -u LD_LIBRARY_PATH SSH_AUTH_SOCK=/tmp/danny-git-ssh-agent.sock ssh -T git@github.com
   # → "Hi danmuzata! You've successfully authenticated, but GitHub does not provide shell access."
   ```
7. Switched the remote from HTTPS to SSH:
   ```
   git remote set-url origin git@github.com:danmuzata/danmuzata.github.io.git
   ```
8. Push still failed with "Repository not found" — at this point confirmed
   (via `git ls-remote` against a couple of name/case variants) that the
   repo genuinely did not exist yet, not a permissions issue.
9. Created the repository on GitHub directly:
   `github.com/new` → owner `danmuzata`, name exactly `danmuzata.github.io`,
   public, **no** README/.gitignore/license (so it started empty and the
   local history could be pushed as-is).
10. Pushed successfully:
    ```
    env -u LD_LIBRARY_PATH SSH_AUTH_SOCK=/tmp/danny-git-ssh-agent.sock git push -u origin main
    # → * [new branch]      main -> main
    ```

## How to avoid this next time

- **Before troubleshooting auth, check the repo exists.** `git ls-remote
  <url>` against the exact remote is the fastest way to tell "repo doesn't
  exist" apart from "auth is broken" — GitHub's error text differs
  (`Repository not found` vs. an authentication-specific error).
- **A `.github.io` user/org Pages site must be named exactly
  `<account>.github.io`.** If the GitHub *username* is ever renamed later,
  existing repos are **not** renamed automatically — only the owner segment
  in URLs updates. Double-check the repo name still matches the current
  username if a rename ever happens again.
- **If HTTPS push fails with a `vscode-git-*.sock` / `ECONNREFUSED` error**,
  it means the terminal's VS Code credential bridge is stale. Either restart
  the owning VS Code window, or just push over SSH instead (more reliable
  from a background/CLI session like this one).
- **If `ssh`/`ssh-add` throws `OpenSSL version mismatch`**, it's the
  `bioatlas` conda environment's `LD_LIBRARY_PATH` shadowing the system
  OpenSSL. Prefix the command with `env -u LD_LIBRARY_PATH`.
- **The SSH agent from this session is not permanent.** It was started
  manually on `/tmp/danny-git-ssh-agent.sock` and only lives as long as that
  process does. For a persistent setup, add the key to a normal login
  `ssh-agent` (e.g. via `ssh-add` in a regular interactive shell, or a
  `keychain`/`gnome-keyring` integration) so future sessions don't need to
  repeat steps 4–6.

## Making day-to-day pushes not require any of this (done 2026-09-15)

Two changes were made so a normal `git push origin main` "just works" from
any new terminal, without manually exporting anything:

1. **Fixed the OpenSSL mismatch for git specifically**, without touching the
   shell's `LD_LIBRARY_PATH` globally (which would've broken other tools
   that depend on the `bioatlas` conda env):
   ```
   git config --global core.sshCommand "env -u LD_LIBRARY_PATH ssh"
   ```
2. **Auto-export the agent socket in every new interactive shell**, added to
   the bottom of `~/.bashrc`:
   ```bash
   export SSH_AUTH_SOCK=/tmp/danny-git-ssh-agent.sock
   if ! env -u LD_LIBRARY_PATH ssh-add -l >/dev/null 2>&1; then
     echo "note: git-push SSH agent isn't running/unlocked — see ~/.bashrc for the two commands to restart it" >&2
   fi
   ```

With both in place, a fresh terminal only ever needs:
```bash
git add -A
git commit -m "..."
git push origin main
```

**This breaks after a reboot** (or if the agent process is killed) — `/tmp`
and the agent process don't survive that. When it does, `.bashrc` will print
a note on login; fix it with the same two commands as steps 4–5 above:
```bash
ssh-agent -a /tmp/danny-git-ssh-agent.sock
env -u LD_LIBRARY_PATH SSH_AUTH_SOCK=/tmp/danny-git-ssh-agent.sock ssh-add ~/.ssh/id_ed25519
```
This is expected, not a bug — the key's passphrase intentionally isn't
stored anywhere, so it has to be re-entered (by hand, into the terminal)
once per agent lifetime.
