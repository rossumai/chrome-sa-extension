# SFTP — a Console app for the org's SFTP servers

Date: 2026-11-20. Status: built, behind `experimentalUnlocked`.

## 1. Why

Solution architects, onboarding and engagement managers and technical account managers keep
asking the same questions about an integration that imports from or exports to SFTP: did the
file arrive, what is in it, did yesterday's export run, can I place a test file. Today that
means a desktop SFTP client and credentials passed around by chat. The app answers those
questions from the Console, with the credentials kept in the org.

## 2. The constraint: no sockets in an extension

A Manifest V3 extension cannot open a TCP connection, on port 22 or any other:

- `chrome.sockets.tcp` is a Chrome Apps API, and Chrome Apps are discontinued on desktop.
- Direct Sockets (`TCPSocket`) is planned for Isolated Web Apps only (WICG explainer).
- `fetch` and `WebSocket` speak HTTP. Port 22 is also on the Fetch standard's blocked-port list.

The alternatives were a WebSocket-to-TCP relay (a new server someone has to run), a native
messaging host (a local install), or the org itself. The app uses the org.

## 3. The helper hook

Every SFTP call runs in a function hook in the connected org (`src/sftp/helperCode.ts`):

- `type: function`, `runtime: python3.12`, `third_party_library_pack: professional_services`,
  `active: true`, `events: ['invocation.manual']`, `queues: []`, and a `description` saying
  what it is and how to remove it. Rossum never runs it on a document; only
  `POST /hooks/{id}/invoke` does.
- Rossum stops waiting for the function after the hook's `timeout_s` (30 s) and answers
  "Read timeout on endpoint URL". So the TCP connect has one 10 s budget for all of the host's
  addresses together (`socket.create_connection` waits the timeout per address, and a host with
  three addresses took exactly 30 s), and a server that does not answer is reported with the
  helper's outbound IP, so someone can allow it.
- The body of an invocation is `{ops: [...]}`: `list`, `download`, `upload`, `delete`,
  `rename`. One invocation is one SSH session: connect, compare the host key with the pinned
  one, sign in, run the ops in order, close. Each op answers on its own.
- Errors are RETURNED as `{error}`. A raised exception reaches the Console only as Rossum's
  "Hook invocation failed".

Measured on a test org on 2026-11-19:

| Question | Answer |
|---|---|
| Does the runtime have an SSH library? | No: AWS Lambda, Python 3.12, boto3 and urllib3, no `paramiko`, no `cryptography`. |
| Can it reach an SFTP server on a custom port? | Yes: it read the server's banner on port 22001. |
| Is there a pack with paramiko? | Yes (2026-11-20): `professional_services` ships paramiko 3.5.1, cryptography 45, bcrypt and PyNaCl. A cold call took 5 s, a warm one 1 s. |
| Does PATCH replace `config`? | No, it merges: `timeout_s` and the other keys survive. |
| Does `/hooks/{id}/test` pass `settings` and `secrets`? | No, only the payload sent. It cannot be used. |
| Does `/hooks/{id}/invoke` pass them? | Yes, and the request body's keys too. |
| Does GET return secrets? | No: `secrets: null`. |
| Does PATCH replace or merge secrets? | Merge. |
| A just-created function? | Answers 400 "FunctionNotReadyException: Initializing extension" for a few seconds. |

The round trip (list, upload, download with matching bytes, delete) passed with 1 KB and 3 MB
files and the password only in the hook's secrets.

## 4. Saved servers

One helper hook per server (`src/sftp/servers.ts`). Its `settings` hold
`kind: 'sa-extension-sftp'` (the marker the list filters on), host, port, user, the sign-in
method and the pinned host key. The password or private key is in its `secrets`.

So the saved servers are shared by everyone with access to the org, persist across sessions
and devices, and nobody can read a password back, not even an admin. The cost is the same
sentence turned round: anyone who can open the Console for the org can use the server. The
form says so.

- **Add** creates the hook and opens the server.
- **Edit** PATCHes name, settings and code; it sends `secrets` only when something was typed.
  A changed host or port drops the pinned host key.
- **Remove** deletes the hook and its secret. Files on the server are not touched.

## 5. Host keys

The first successful call pins the server's host key (`ssh-ed25519 SHA256:…`) into the hook's
settings. A helper whose code or library pack is older than the build's (`stale`) is PATCHed
before its next call, so every call runs the current code. After that, a different key stops every call: the page shows the old and the new key
and a "Trust the new key" button, which pins the new one.

## 6. The page

The first view lists the org's servers. Opening one shows its files; "SFTP servers" in the bar
goes back. There is no Disconnect: nothing stays connected between calls.

- **Arrival strip** (`arrivals.ts`): files per local day over the last 14 days, one tick per
  file. A weekday with nothing, after the first day that had a
  file, gets a dashed tick and a line such as "Nothing arrived on Wed 11 Nov". Clicking a day
  shows only its files.
- **File list**: folders first, then files newest first; a "New today" tag; download and
  delete per row; upload by button or drop, with a confirmation before replacing a file.
- **Preview pane** (`preview.ts`): reads the first 512 KB only. A CSV as a table (separator
  detected, first 200 rows), other text as text, both cut to whole lines when the file is
  longer; binary refused. An image (PNG, JPEG, GIF, WebP, BMP, ICO, AVIF, SVG) or a PDF — by
  extension, `mediaOf` — is read whole, up to 10 MB, and shown from a blob URL with Open in a
  tab: an image drawn on a checkerboard with its pixel size (an SVG goes through an `<img>`, so
  its scripts never run); a PDF in Chrome's own viewer in an `<iframe>`, as the DevTools
  panel's preview does, with `#navpanes=0&view=FitH` and a pane widened to
  `min(680px, 48vw)`. The toolbar then stays on one line: the filter and the host name shrink.
  Download reuses the bytes. Download, Copy path, Rename or move, Delete.
- **Preloading**: every listing is `depth: 1`, so it brings the listings of up to 25
  subfolders in the same SSH session. The page keeps every listing for the visit: a folder seen
  before opens at once and is refreshed quietly ("Refreshing…" on the toolbar). An answer for
  a folder the user has since left only fills the cache.
- **Busy state**: a running call covers the file list with a card saying what it does and the
  elapsed seconds; a starting function adds that it can take a minute. A transfer adds MB done
  of the total and Cancel, which stops between two parts.

## 6a. Files of any size

A Lambda request and answer are capped near 6 MB, and base64 adds a third, so contents move in
3 MB parts (`transfer.ts`), one call each: `download` and `upload` take an `offset`. A download
joins the parts in the Console. An upload of more than one part writes a hidden
`.<name>.part` beside the target (never listed); its last call writes the last part and renames
it over the target (`posix_rename`, else delete then rename), so an interrupted upload never
leaves a half-written file under the real name, and a failed or cancelled one deletes its part.
Measured 2026-11-20 on the test server: 3–5 s per 3 MB part (a 7 MB file up in three calls and
back in three, bytes identical), so about a minute for 50 MB.
- Delete and replace ask first (`confirmModal`); rename uses `promptModal`.

## 7. Limits and open risks

- **Large files are slow, not refused**: about 1 MB/s, one call per 3 MB, and the browser holds
  the whole file in memory while it moves.
- **Rossum's network must be allowed by the server.** On 2026-11-20 the test server answered
  from a laptop but timed out from the helper (outbound IP shown in the error); the day before,
  the same server answered the helper. A customer's server with an IP allowlist needs Rossum's
  addresses on it.
- The pack's paramiko version is Rossum's choice, not ours.
- No folder creation, no recursive delete, no transfer of whole folders.

## 8. Wiring

`sftp` is the tenth app: `apps.tsx` (`exp`, `gated`), `boot.ts` (`isValidApp`, `GATED_APPS`),
`Console.tsx`, `console/index.tsx` (title, store, usage event `sa_console_app_sftp`, listed in
`PRIVACY.md`). The popup's "fell back to Data" check now uses `isGatedApp` instead of naming
the gated apps, and its Console view leaves the tenth app without a key number, since only
keys 1–9 switch apps.
