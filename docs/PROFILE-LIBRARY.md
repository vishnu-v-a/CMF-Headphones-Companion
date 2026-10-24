# Named local profiles

The Profiles tab now has a persistent library in addition to the built-in
Harman reference. **Equalizer → Save profile** (or **Profiles → Save current**)
saves the editor draft with a name and optional listening notes. Saving does
not read or write the headphones. The saved contents include the active
filters, disabled filter IDs, preamp and, when applicable, sound-slider values.
Inactive editor slots are placeholders, not additional saved filters.

Open a saved card to preview it in Equalizer, then use the existing **Apply to
headphones** flow. Opening a profile does not select Custom EQ in Nothing X,
change ANC/spatial settings, or apply its listening notes. The draft Undo
action can recover the preceding valid editor draft.

Two cards per page, search by name/notes and previous/next buttons keep the
library compact. The original headphone recovery backup and the read-only
Harman reference remain separate from user profiles.

## Save, update and recover

- New names create separate profiles, up to 100. Names ignore case when
  checking duplicates; they must contain 1–80 characters without controls.
- A matching name exposes **Update existing**. Save new never silently
  replaces it. Updates preserve the saved identity and creation time.
- The card's **···** button opens Manage profile. Save changes renames it or
  changes its notes while preserving that card's EQ, regardless of the editor.
- Remove moves the file to a local trash folder. **Undo remove** restores the
  most recently removed profile in that app session, unless its name is now in
  use or the library is full. Older removed files remain in trash for manual
  recovery; there is no automatic purge.
- Existing single working-draft caches still reopen. A successful named save
  also updates that cache when local storage is available. Profiles saved by
  an older app must be opened in the editor and saved once to join the library.
- Export .txt remains available in Equalizer after opening a card. These are
  Equalizer APO parametric files, not Wavelet GraphicEQ files.

## Storage and consistency

Files live under `%APPDATA%\app.cmfeq.desktop\profiles\<id>.json`, separate
from `eq-backups`. They are local to this Windows account and are not synced
to GitHub. Copy the profiles folder separately if backing up the library.
Names are metadata; validated generated identities form the filenames.

Native commands serialize access within the app, with an exclusive Windows
file handle for concurrent app instances. Updates/removals must match the
saved revision. Writes use a synced temporary file, rename, and readback;
existing profiles survive validation errors. Invalid/unsupported files are
skipped with a warning and retained, not silently deleted. Each file is
limited to 64 KB.

Normal EQ validation and Apply headroom restrictions still apply. A stored
positive-preamp draft is not permission to bypass the separate experimental
Output gain controls. The library is not an audio processor or volume unlock.

## Validation

JavaScript syntax and diff whitespace checks were performed. The Windows
release is built with the existing GitHub Actions workflow, without automated
tests as required by this repository. No hardware commands are involved in
profile saving/loading. Live UI inspection was unavailable because the
computer-use runtime could not initialize; on-device persistence and layout
confirmation remain owner checks.
