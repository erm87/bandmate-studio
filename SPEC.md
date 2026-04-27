# BandMate file-format & USB layout spec

This is the contract BandMate Studio must produce for the BandMate hardware to read playfiles successfully. Everything here was derived from inspecting working files on the production USB drive plus the BandMate User Manual v0.12 (pp. 5–12).

If you change anything here, double-check it round-trips through a known-good BandMate playfile (`Buffy/Buffy.jcs`, `May v3.jcp`, etc. on Eric's Lexar stick).

## USB layout

The BandMate scans `bm_media/bm_sources/` on the USB root and presents whatever it finds.

```
<USB root>/
├── bm_media/
│   ├── bm_sources/
│   │   ├── <Song Folder Name>/
│   │   │   ├── <Song Folder Name>.jcs       # song-config file (one per folder)
│   │   │   ├── <track1>.wav                  # mono WAV files at the song's sample rate
│   │   │   ├── <track2>.wav
│   │   │   └── ...
│   │   ├── <Another Song>/
│   │   │   ├── <Another Song>.jcs
│   │   │   └── ...
│   │   ├── <Playlist Display Name>.jcp      # playlist-config files (any number, flat)
│   │   └── <Another Playlist>.jcp
│   └── bm_trackmaps/
│       ├── <track-map-name>.jcm              # track-map files (any number, flat)
│       └── ...
└── bm_update/                                # firmware update area (separate concern)
    └── bm_files/
        └── <build-name>                       # .mcpb files for on-device boot-time UPDATE menu
```

**Conventions observed:**
- Song folder name and the `.jcs` file inside it must match (e.g., folder `Buffy/` contains `Buffy.jcs`).
- Playlist `.jcp` files live one level up from song folders, in `bm_sources/`.
- Track maps live in `bm_trackmaps/`.
- Filenames may contain spaces and parentheses; we've seen `Tie Her Down (no intro)/` and `Croc Tears (cut)/`.
- The BandMate also tolerates files without an extension in `bm_update/bm_files/` (JoeCo's stock builds ship without `.mcpb`).

## Track Map: `.jcm`

Plain ASCII text, **one channel name per line**, starting from channel 1.

**Important:** observed line endings are **CRLF** (Windows-style `\r\n`). The BandMate runs Linux but the BM Loader was likely authored on Windows. We should preserve this convention to stay drop-in compatible — write CRLF on save.

Example (`default_tm.jcm` from `bm_loader.app/Contents/Resources/TrackMaps/`):

```text
Click
Hihat
Kick
Snare
TomsL
TomsR
Overhead
Bass
RhythmG
Keys1L
Keys1R
BVox1
BVox2
Horns1
Horns2
Perc1
Perc2
Sax
Lead Vox
Lead G
Moog
noises off
MixL
MixR
MIDI
```

**Notes on parsing:**
- Each line is a label for the corresponding output channel. Channel index = (line number - 1) starting from 0, or (line number) if you index from 1.
- Lines may contain spaces (e.g. `Lead Vox`).
- The trailing `MIDI` is the conventional last entry — channel that the BandMate uses for MIDI output naming (cosmetic, not a wire MIDI assignment).
- Default and `stems_tm.jcm` ship with the stock BM Loader.
- Eric's `erictest_tm.jcm` lives at `bm_media/bm_trackmaps/erictest_tm.jcm` on the USB.

## Song: `.jcs`

XML-ish plain text. Looks like XML but is tag-soup (no XML declaration, no namespaces, sometimes self-closing tags). Tolerant of formatting; stock BM Loader writes pretty-printed with 4-space indent.

Schema:

```xml
<song>
    <srate>48000</srate>            <!-- integer Hz: 44100 or 48000 -->
    <length>9699328</length>         <!-- integer total length in SAMPLES (not seconds) -->
    <file>
        <filename>Time Code_buffy.wav</filename>
        <ch>0</ch>                   <!-- output channel index (0-based) -->
        <lvl>1.0</lvl>                <!-- float gain multiplier; 1.0 = unity -->
        <pan>0.5</pan>                 <!-- float 0.0=L, 0.5=center, 1.0=R -->
        <mute>1.0</mute>               <!-- float; 1.0 = NOT muted, 0.0 = muted -->
    </file>
    <file>
        ...
    </file>
    <!-- ... one <file> entry per WAV in the song folder ... -->
</song>
```

**Real example** (`Buffy/Buffy.jcs`):

```xml
<song>
    <srate>48000</srate>
    <length>9699328</length>
    <file>
        <filename>Time Code_buffy.wav</filename>
        <ch>0</ch>
        <lvl>1.0</lvl>
        <pan>0.5</pan>
        <mute>1.0</mute>
    </file>
    <file>
        <filename>ClickCues_buffy.wav</filename>
        <ch>1</ch>
        <lvl>1.0</lvl>
        <pan>0.5</pan>
        <mute>1.0</mute>
    </file>
    ...
</song>
```

**MIDI tracks** are also represented as `<file>` entries — the filename ends in `.mid` instead of `.wav`, and the channel index for MIDI is conventionally treated as the last entry (the row labeled `MID` / `MIDI` in BM Loader's UI). The BandMate routes `.mid` files to its MIDI OUT port (via `mC.midioutbuf` in firmware).

**Hard rules from the manual:**
- All audio files **must be mono WAV** at the song's `<srate>`. Stereo files are rejected by BandMate at load. BM Loader is supposed to highlight stereo source files in red — we should preserve that.
- `<length>` is the total length in samples, computed from the longest WAV. We'll calculate this on save by reading WAV headers.
- All channel indices in `<ch>` must be unique within a song. (The BandMate's track map maps channel index → physical output.)

**Things to be lenient about on read:**
- Whitespace/indentation
- Tag order (write canonical order on save: `srate`, `length`, then `<file>` entries)
- Trailing newlines
- Mixed `\n` vs `\r\n` line endings — read both, write `\n`

## Playlist: `.jcp`

Same XML-ish dialect as `.jcs`. Lives flat in `bm_sources/`.

Schema:

```xml
<playlist>
    <playlist_display_name>May v3</playlist_display_name>
    <srate>48000</srate>
    <trackmap>erictest_tm.jcm</trackmap>
    <song_name>Tie Her Down (no intro)</song_name>
    <song_name>Golden Glove</song_name>
    <song_name>Buffy</song_name>
    <!-- one <song_name> per song in playlist order -->
</playlist>
```

**Real example** (`May v3.jcp`):

```xml
<playlist>
    <playlist_display_name>May v3</playlist_display_name>
    <srate>48000</srate>
    <trackmap>erictest_tm.jcm</trackmap>
    <song_name>Tie Her Down (no intro)</song_name>
    <song_name>Golden Glove</song_name>
    <song_name>Buffy</song_name>
    <song_name>Small Time Crooks</song_name>
    <song_name>Dearly Beloved</song_name>
    <song_name>The Difference</song_name>
    <song_name>Strange</song_name>
    <song_name>Hot Head</song_name>
    <song_name>China Doll</song_name>
    <song_name>Crocodile Tears</song_name>
    <song_name>Rabid</song_name>
</playlist>
```

**Parser notes:**
- `<playlist_display_name>` is what shows on the BandMate screen — can have spaces.
- The `.jcp` filename on disk should match `<playlist_display_name>` (e.g. `May v3.jcp`), but the BandMate reads `<playlist_display_name>` for the UI label, so a mismatch is *probably* tolerated.
- `<song_name>` values must match existing folder names under `bm_sources/`. We should validate and warn on save if any are missing.
- Order matters — the BandMate plays songs in the listed order.
- All songs in a playlist should share a sample rate (`<srate>`) — mixed sample rates would cause re-init between songs and have been a source of weirdness in production.

## Source/working folder layout (BM Loader convention)

The BM Loader operates on a "Working Folder" on the user's computer that mirrors the eventual USB layout. The convention is:

```
<Working Folder>/
└── bm_media/
    ├── bm_sources/
    │   ├── <Song Folder Name>/
    │   │   ├── <Song Folder Name>.jcs
    │   │   └── <copies of WAVs>
    │   └── <Another Song>/
    └── bm_trackmaps/
        └── <track-map-name>.jcm
```

When a user creates a new song in BM Loader and points "Path to Source Files" at some external location (e.g. their Logic Pro bounce folder), BM Loader **copies** the selected WAVs into `<Working Folder>/bm_media/bm_sources/<song>/`. The original source folder is untouched. The Working Folder is what gets pushed to the USB.

We'll preserve this exact convention so a user can switch back and forth between BM Loader and BandMate Studio against the same Working Folder without conflicts.

## Quirks to preserve / behaviors to match

- **CRLF line endings in `.jcm` files** (write CRLF on save, accept either on read).
- **`bm_update/bm_files/` files have no required extension** — the on-device update menu lists everything in that folder verbatim, so we should let the user write `.mcpb` files there as-is.
- **Hidden `._*` AppleDouble files break the BandMate's UI** — see `Bandmate/MANUAL_ADDITIONS.md`. BandMate Studio should integrate `dot_clean -m` automatically into the "Download to USB" workflow on macOS.
- **Bundle identifier matters for the macOS app icon** — set `com.brigades.bandmate-studio` (or similar), don't leave the Tauri default.
- **Stereo WAV files cannot be used** — flag visually and prevent assignment.

## What we explicitly do NOT replicate

- The BM Loader's three-tab layout (Track Loader / Playlist Editor / Uploader). We're free to redesign IA — see MVP-PLAN.md.
- Two-step "Browse → Set" working-folder pattern. One step is enough.
- The "<< Copy" / "<< Copy All" buttons for moving from source to destination. Drag-drop is the modern equivalent.
- The blue up/down arrow row buttons. Drag-to-reorder replaces them.
- The red row-delete buttons. Delete key replaces them (with right-click contextual menu as fallback).

## Open questions for v0.2+

- **`.jcm` channel-count cap**: the on-device track map seems to expect exactly 25 channels (1–24 audio + MIDI). Do we hard-enforce that limit, or warn-and-allow?
- **`.jcs` `<length>` derivation**: should this match the longest WAV's sample count, or the shortest? Stock BM Loader uses longest. We follow.
- **Sample-rate mismatch between songs in a playlist**: warn on playlist save? Block? Stock BM Loader doesn't seem to enforce.
- **Notation for muted-track distinction**: `<mute>` is a float for some reason. Is anything other than 0.0 / 1.0 meaningful? (Probably no, but worth confirming.)
