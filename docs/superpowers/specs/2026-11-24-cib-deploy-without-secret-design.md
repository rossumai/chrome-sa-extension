# CIB deploy without the Coupa client secret

Date: 2026-11-24. A delta on `2026-11-16-cib-upgrade-design.md` and `2026-11-02-cib-deploy-auto-target-design.md`.

## Why

Some customers keep the Coupa OAuth client secret and do not hand it to whoever deploys CIB. Their own admin pastes it into the hooks' Secrets in the Rossum UI afterwards. Until now the deploy could not run without it: `engine.ts` refuses an unresolved `$secret:client_secret`, and the upgrade blocked on it.

The Coupa URL and the client ID are not secret and stay required (owner's call).

## What changes

- **Step 2** gets a checkbox, "Deploy without the secret: the organization's admin adds it". Ticked, the secret field is hidden and not required, and the hint says what follows. The client ID stays visible and required: it is not secret, and it is written into 13 hooks' settings and the `oauth_client_id` field of 10 schemas (v2.2.1), which an admin would otherwise have to edit by hand. It is a deliberate choice, never an empty field: an empty secret with the box unticked still fails the form's `required`.
- **`configurePlan`**, given no secret: each `patch_secret=true` hook is still created inactive, and its patch is `{active: <release's flag>}` — no `secrets`, no placeholder (the owner accepts that scheduled imports and exports fail with an auth error until the secret is in). With a secret the patch is byte-for-byte what it was, so the checkpoint keeps its shape. It now also returns `secretHooks`, the keys of those hooks.
- **`deployCib`**, without a secret: the Coupa credentials check is skipped with a note (it cannot log in); memorisation runs; the first imports are NOT invoked and no dataset is waited for (they would only fail). The run is marked `complete` with `secretGiven: false` in its record, and the result carries `needSecret: [{name, url}]`. The verdict is a warning naming the count.
- **Resume follows the checkpoint, not step 2.** Whether a run sets the secret is decided by the patches its checkpoint stored: a run started with the secret refuses to resume without it (a blocker, rather than the engine's `no value given`); a run started without it never sets one, even when step 2 now holds it, and says so in a note.
- **Upgrade**: the old blocker is gone. Without a secret, new secret hooks are created active without it, their imports are not invoked, the record gets `secretGiven: false` and the result lists them (`needSecret`). Check upgrade says so in a note. The same resume rule applies.
- **The result** lists every hook that needs `client_secret`, each linked to its page in the Rossum UI, `<domain>/extensions/my-extensions/<id>` — the route the CIB page already uses for the check function, the DevTools panel detects and the resource-ids content script reads off the Rossum UI's own anchors.

## Not done

- No read of `GET /hooks/{id}/secrets_keys` to tell later which hooks have since received the secret; the list is what this run left without it.
- A run that started without the secret is not re-run to set it; the admin pastes it in the Rossum UI.
