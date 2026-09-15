# Privacy

Evercast collects nothing, sends nothing, and has nowhere to send it to.

This document exists because "we don't collect anything" is a claim, and a claim
is worth more when it says exactly what it covers and how to check it.

## What is stored, and where

Three keys in the browser's own `localStorage`, on the device the game is played
on, and one cache of the game's own files. Nothing leaves it.

| Key | What it holds | Written by |
| --- | --- | --- |
| `evercast.save.v1` | The run: frontier, wallets, spell tree, gear, companions | `src/app/BrowserSaveStore.ts` |
| `evercast.ui.v1` | Preferences: volumes, effect quality, damage numbers | `src/app/UiSettingsStore.ts` |
| `evercast.clock.v1` | One number — the latest clock reading seen, so offline time cannot be farmed | `src/app/AwayClock.ts` |

Alongside them, a single Cache Storage bucket named `evercast-v1`, written by
the service worker in `public/sw.js`. It holds copies of the files the game
already downloaded to run - the bundle, the two typefaces, the `.glb` models -
so that a second visit does not fetch six megabytes again and so the game opens
with no network at all. It records nothing about the player: every entry is a
response to a request for one of Evercast's own files, and the worker refuses
any request that is not same-origin, so nothing else can ever land in it.
Clearing site data removes it along with everything else.

None of it is personal data. There are no accounts, no names, no email
addresses, no device or advertising identifiers, and no identifier that could
be used to recognise the same player on another site or another device. The
save is a description of a fictional wizard's progress.

Under the GDPR and similar regimes this is storage that is
[strictly necessary](https://gdpr-info.eu/recitals/no-30/) for a service the
user explicitly requested — a game that remembers the game — so it needs no
consent banner. It would need one the moment anything here became an analytics,
advertising or cross-site identifier, which is a line worth keeping in mind
before adding a fourth key.

## What is sent

Nothing. There is no server, no API, no analytics, no error reporting, no
telemetry, no embedded third-party script, no font CDN, no social widget and no
advertising.

The only network requests the game makes are for its own files — the JavaScript
bundle, the stylesheet, the two `.woff2` typefaces under `public/fonts/`, the
`.glb` models under `public/models/`, the web app manifest and the icons beside
it — all from the origin the page was served from. The service worker makes the
same requests and no others; `src/app/WebManifest.test.ts` fails if a host ever
appears in it.

The typefaces are the reason "no font CDN" is worth stating rather than
assuming. Gelasio and Inter are both under the SIL Open Font License (the full
text of each ships beside them in `public/fonts/`), so they are served from the
site itself. A `<link>` to Google Fonts would have been two lines less work and
would have told a third party the IP address, the user agent and the referring
page of everyone who opened the game.

Check it yourself, two ways:

```bash
# No absolute URLs anywhere in the source.
grep -rnoE "https?://[a-zA-Z0-9./_-]+" src/ index.html
```

and, in the browser, the Network tab: every request is same-origin. The
deployed Content-Security-Policy enforces this rather than relying on it —
`connect-src 'self'` means that even a future dependency that tried to phone
home would be blocked by the browser rather than quietly succeeding. See
`vercel.json`.

## What the player controls

Settings → Account, in the game:

- **Export save** writes the whole save to a file the player keeps.
- **Import save** replaces it from such a file.
- **Erase progress** deletes `evercast.save.v1`, and only that. Settings and the
  clock key are not progress, so a reset does not take a player's volume levels
  or reopen the offline-time question with them.

Clearing site data for the origin is what removes all three keys, the file
cache, and leaves nothing behind. Uninstalling the app, where it was installed
to a home screen, does the same on most platforms. The distinction is worth keeping straight in both directions:
the in-game copy in Settings says the same thing, and a disclosure that
overstates what a button does is worse than no disclosure at all.

There is no copy anywhere else, which is the other half of "nothing leaves the
device": there is nothing to request, nothing to rectify and nothing to delete
on request, because there is no controller holding it.

## If this ever changes

Adding a leaderboard, cloud saves, analytics or crash reporting would make
Evercast a service that processes personal data, and would need — at minimum —
a privacy notice shown to players, a lawful basis for the processing, and a
consent mechanism for anything not strictly necessary. The CSP in `vercel.json`
would have to be widened to allow it, which is a deliberately visible change to
have to make.
