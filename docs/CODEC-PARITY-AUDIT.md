# Codec Parity Audit — BandMate Studio vs BM Loader

**Date:** 2026-04-28
**Scope:** Compare our TypeScript codec writers/readers in `src/codec/`
against the decompiled BM Loader code in `decompiled/per_function/playlistparse/`
and `decompiled/module_level/playlistparse.py`.

The goal is to ensure files BandMate Studio writes are byte-compatible with
BM Loader's reader, and that files BM Loader writes are loadable by ours.

## Method

Read the relevant decompiled functions side-by-side with our codec:

| Format | BM Loader writer                | BM Loader reader               | Our codec       |
| ------ | ------------------------------- | ------------------------------ | --------------- |
| `.jcs` | `Song.saveSong` (`0022_*.py`)   | `PlayList.loadPlaylist` body   | `src/codec/jcs.ts` |
| `.jcp` | `PlayList.savePlaylist` (`0027_*.py`) | `PlayList.loadPlaylist` (`0028_*.py`) | `src/codec/jcp.ts` |
| `.jcm` | n/a (BM Loader does not write track maps directly — UI edits the file with plain text I/O) | n/a | `src/codec/jcm.ts` |

Both BM Loader writers use a custom `indent()` helper (4-space level
indentation) and Python's `ElementTree.write()` with default UTF-8 encoding
and no XML declaration. See `module_level/playlistparse.py` lines 19–36.

## Findings

### 1. `<trackmap>` is optional (FIXED)

**Severity:** Critical — round-trip breaker.

BM Loader's `savePlaylist` emits `<trackmap>` only when non-empty:
```python
if trackmap != '':
    linktmxml = ET.SubElement(pLxml, 'trackmap')
    linktmxml.text = str(trackmap)
```

BM Loader's `loadPlaylist` wraps the read in try/except so a missing element
is treated as "no trackmap":
```python
try:
    self.trackMap = tree.find('./trackmap').text
    ...
except:
    print('trackmap not found...')
    trackMapExists = False
```

**Our codec before audit:**
- Writer: always emitted `<trackmap>...</trackmap>` even when empty.
- Reader: required the element via `requireString` → threw on missing/empty.

**Our codec after audit:**
- Writer: emits `<trackmap>` only when `trackMap !== ""`.
- Reader: missing or empty element → `trackMap: ""`.

Tests: `src/codec/jcp.test.ts` — see "`<trackmap>` parity with BM Loader"
describe block.

### 2. `<lvl>/<pan>/<mute>` only emitted for `.wav` files (NO ACTION)

**Severity:** None in current usage.

BM Loader's `saveSong` checks the file extension before emitting level/pan/mute:
```python
if file_extension == '.wav':
    lvlxml = ET.SubElement(filexml, 'lvl')
    ...
```

Our writer always emits these three for every entry in `audioFiles`. This
would diverge if our `audioFiles` list ever contained a non-WAV entry, but
the app's UI only assigns WAVs to channels (the assignment dialog filters
to `.wav`), so this is currently moot.

**Decision:** No code change. Documented for future reference if we ever
allow non-WAV channel assignments.

### 3. Empty `<song_name>` skipped on write (NO ACTION)

**Severity:** None in current usage.

BM Loader's `savePlaylist`:
```python
for i in range(len(songs)):
    if not songs[i] != '':
        continue
    sngxml = ET.SubElement(pLxml, 'song_name')
    sngxml.text = str(songs[i])
```

Our writer iterates over `songNames` directly. Our `Playlist` type and the
PlaylistEditor never produce an empty entry, so this is moot. Documented
in case a hand-edited fixture ever breaks the assumption.

### 4. `<solo>` element (NO ACTION)

BM Loader's `loadPlaylist` reads `file.find('solo')` for each `<file>`,
but `saveSong` never writes one. The reader's body that would have used
the result was truncated by the decompiler (the loop's `j = j + 1` is the
only surviving line), so `<solo>` appears to be a dead read in current
versions. We don't read or write it. No action.

### 5. `<length>` field — `use_tool` branch (NO ACTION)

BM Loader's `saveSong` uses different fields depending on a `use_tool` flag:
```python
if use_tool == True:
    lengthxml.text = str(int(self.song_length))      # seconds
else:
    lengthxml.text = str(int(self.song_length_samples))  # samples
```

`use_tool` is a BM Loader-internal UI mode. The on-disk format for the
non-tool path (which is what BandMate hardware reads) uses
`song_length_samples`. Our codec writes `lengthSamples` to match. No action.

### 6. MIDI channel constant — 24 (CONFIRMED)

BM Loader's `saveSong` hardcodes `chxml.text = str(24)` for the
`<midi_file>` element. Our `MIDI_CHANNEL_INDEX` constant in
`src/codec/types.ts` is also `24`. Match.

### 7. MIDI emission condition (NO ACTION)

BM Loader's `saveSong` emits `<midi_file>` only when:
```python
if use_tool == False and len(self.midiList) > 0:
```

Our writer emits it whenever `song.midiFile` is set. Equivalent under our
on-disk-only mode (`use_tool == False`), since `midiFile` is undefined when
no MIDI file is assigned. No action.

### 8. Indentation, encoding, line endings (CONFIRMED)

| Property         | BM Loader                              | Ours          |
| ---------------- | -------------------------------------- | ------------- |
| Indent unit      | 4 spaces (custom `indent()` at line 19)| 4 spaces      |
| Encoding         | UTF-8 (ElementTree default)            | UTF-8         |
| XML declaration  | Omitted (encoding triggers no decl)    | Omitted       |
| Line ending      | LF (`tree.write` with default newline) | LF            |
| Trailing newline | Yes (ElementTree appends `\n`)         | Yes           |

All match. Verified against fixtures in `src/codec/__fixtures__/`
(`Buffy.jcs`, `May v3.jcp`, `Simpler Playlist.jcp`) — these are stock
BM Loader-written files and our writer produces byte-identical output
for them (see "byte-identical" test in `jcs.test.ts` / `jcp.test.ts`).

## Outcome

- One real divergence found and fixed (`<trackmap>` optionality).
- Five informational findings documented; no action required given how
  our app currently uses the codec.
- Existing byte-identical round-trip tests still pass against stock
  fixtures (run `npx vitest run` on the macOS host).

The codec is now confirmed parity with BM Loader for files BandMate
Studio writes and accepts a strict superset of files BM Loader writes.
