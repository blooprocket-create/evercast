# Privacy

Evercast collects nothing, sends nothing, and has nowhere to send it to.

This document exists because "we don't collect anything" is a claim, and a claim
is worth more when it says exactly what it covers and how to check it.

## What is stored, and where

Three keys in the browser's own `localStorage`, on the device the game is played
on. Nothing leaves it.

| Key | What it holds | Written by |
| --- | --- | --- |
| `evercast.save.v1` | The run: frontier, wallets, spell tree, gear, companions | `src/app/BrowserSaveStore.ts` |
| `evercast.ui.v1` | Preferences: volumes, effect quality, damage numbers | `src/app/UiSettingsStore.ts` |
| `evercast.clock.v1` | One number — the latest clock reading seen, so offline time cannot be farmed | `src/app/AwayClock.ts` |

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
bundle, the stylesheet, and the `.glb` models under `public/models/` — all from
the origin the page was served from.

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

Clearing site data for the origin is what removes all three keys and leaves
nothing behind. The distinction is worth keeping straight in both directions:
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
