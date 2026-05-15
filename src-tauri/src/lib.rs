// BandMate Studio — Rust backend (Tauri commands)
//
// All filesystem operations live here rather than in the JS layer
// because:
//   1. Tauri's JS-side fs plugin restricts paths to allow-listed scopes,
//      and we need to read/write arbitrary user-chosen folders. Doing
//      I/O in Rust commands sidesteps that scope-gating cleanly.
//   2. Native FS calls are faster than the round-trip through the
//      asset protocol.
//   3. We get strong typing on the data shapes we hand back to the
//      frontend.
//
// Commands:
//   - greet: Phase 0 sanity check
//   - probe_wav: Phase 1 — read WAV header (channels / sample rate / etc.)
//   - init_working_folder: Phase 2 — ensure bm_media/{bm_sources,bm_trackmaps}/
//     exist under the chosen working folder
//   - scan_working_folder: Phase 2 — enumerate songs / playlists / track maps
//   - read_text_file / write_text_file: Phase 2+ — pass file contents
//     between Rust I/O and the JS-side codec library
//
// Future commands (Phase 6+):
//   - list_usb_drives: enumerate mounted external volumes
//   - copy_to_usb: stream a working folder to a USB drive with progress
//   - dot_clean: shell out to `dot_clean -m <path>` on macOS

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

mod midi;

// ---------------------------------------------------------------------------
// WAV probe (Phase 1)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WavInfo {
    /// Number of audio channels: 1 = mono, 2 = stereo, etc.
    pub channels: u16,
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub duration_samples: u64,
    pub duration_seconds: f64,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! BandMate Studio's Rust backend is alive.", name)
}

#[tauri::command]
fn probe_wav(path: String) -> Result<WavInfo, String> {
    let reader = hound::WavReader::open(&path)
        .map_err(|e| format!("Cannot open '{}': {}", path, e))?;
    let spec = reader.spec();
    let duration_samples = u64::from(reader.duration());
    let duration_seconds = duration_samples as f64 / f64::from(spec.sample_rate);

    Ok(WavInfo {
        channels: spec.channels,
        sample_rate: spec.sample_rate,
        bit_depth: spec.bits_per_sample,
        duration_samples,
        duration_seconds,
    })
}

// ---------------------------------------------------------------------------
// Working folder operations (Phase 2)
// ---------------------------------------------------------------------------

/// Summary of a single song folder under bm_sources/.
///
/// We only return paths here — the frontend reads the .jcs file via
/// `read_text_file` and parses with the TS codec. This keeps a single
/// source of truth for file-format logic in the JS layer.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongSummary {
    /// The folder name (also the song name shown in the UI).
    pub folder_name: String,
    /// Absolute path to the song folder.
    pub folder_path: String,
    /// Absolute path to the <folder_name>.jcs file inside that folder.
    pub jcs_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    /// Filename including extension, e.g. "May v3.jcp".
    pub filename: String,
    /// Absolute path to the .jcp file.
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMapSummary {
    /// Filename including extension, e.g. "erictest_tm.jcm".
    pub filename: String,
    /// Absolute path to the .jcm file.
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub songs: Vec<SongSummary>,
    pub playlists: Vec<PlaylistSummary>,
    pub track_maps: Vec<TrackMapSummary>,
}

/// Ensure the bm_media/{bm_sources,bm_trackmaps}/ subtree exists under
/// Stock BM Loader trackmap templates, embedded at compile time
/// from the codec fixtures. We seed these on fresh `init_working_folder`
/// because BM Loader does — the BandMate hardware may rely on them as
/// fallbacks. Byte-for-byte identical to what BM Loader writes
/// (CRLF separators, no trailing newline, the older bundled convention).
const SEED_DEFAULT_TM: &[u8] =
    include_bytes!("../../src/codec/__fixtures__/default_tm.jcm");
const SEED_STEMS_TM: &[u8] =
    include_bytes!("../../src/codec/__fixtures__/stems_tm.jcm");

/// `path`. Idempotent — safe to call on an already-initialized folder.
///
/// Seeds `default_tm.jcm` and `stems_tm.jcm` into `bm_trackmaps/` if
/// they're not already present (matches BM Loader's first-run behavior).
/// Existing files are never overwritten — the user may have edited the
/// templates and we don't want to silently revert their changes.
#[tauri::command]
fn init_working_folder(path: String) -> Result<(), String> {
    let bm_media = Path::new(&path).join("bm_media");
    fs::create_dir_all(bm_media.join("bm_sources"))
        .map_err(|e| format!("Cannot create bm_sources under '{}': {}", path, e))?;
    let bm_trackmaps = bm_media.join("bm_trackmaps");
    fs::create_dir_all(&bm_trackmaps)
        .map_err(|e| format!("Cannot create bm_trackmaps under '{}': {}", path, e))?;

    // Seed stock templates. Skip if they exist (idempotent + non-destructive).
    let default_path = bm_trackmaps.join("default_tm.jcm");
    if !default_path.exists() {
        fs::write(&default_path, SEED_DEFAULT_TM).map_err(|e| {
            format!("Cannot seed default_tm.jcm: {}", e)
        })?;
    }
    let stems_path = bm_trackmaps.join("stems_tm.jcm");
    if !stems_path.exists() {
        fs::write(&stems_path, SEED_STEMS_TM).map_err(|e| {
            format!("Cannot seed stems_tm.jcm: {}", e)
        })?;
    }

    Ok(())
}

/// Enumerate songs, playlists, and track maps under a working folder.
///
/// Looks for:
///   - bm_media/bm_sources/<folder>/<folder>.jcs    (songs)
///   - bm_media/bm_sources/*.jcp                     (playlists)
///   - bm_media/bm_trackmaps/*.jcm                   (track maps)
///
/// Sorted alphabetically by name within each category. Missing
/// subdirectories are tolerated (returns empty lists).
#[tauri::command]
fn scan_working_folder(path: String) -> Result<ScanResult, String> {
    let bm_media = Path::new(&path).join("bm_media");
    let bm_sources = bm_media.join("bm_sources");
    let bm_trackmaps = bm_media.join("bm_trackmaps");

    let mut songs = Vec::new();
    let mut playlists = Vec::new();
    let mut track_maps = Vec::new();

    if bm_sources.is_dir() {
        for entry in fs::read_dir(&bm_sources)
            .map_err(|e| format!("Cannot read {:?}: {}", bm_sources, e))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let entry_path = entry.path();

            if entry_path.is_dir() {
                // Song folder: look for <folder_name>/<folder_name>.jcs
                if let Some(folder_name) = entry_path.file_name().and_then(|n| n.to_str()) {
                    // Skip macOS / OS hidden folders defensively
                    if folder_name.starts_with('.') {
                        continue;
                    }
                    let jcs = entry_path.join(format!("{}.jcs", folder_name));
                    if jcs.is_file() {
                        songs.push(SongSummary {
                            folder_name: folder_name.to_string(),
                            folder_path: entry_path.to_string_lossy().to_string(),
                            jcs_path: jcs.to_string_lossy().to_string(),
                        });
                    }
                }
            } else if entry_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("jcp"))
                .unwrap_or(false)
            {
                if let Some(filename) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if filename.starts_with('.') {
                        continue;
                    }
                    playlists.push(PlaylistSummary {
                        filename: filename.to_string(),
                        path: entry_path.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    if bm_trackmaps.is_dir() {
        for entry in fs::read_dir(&bm_trackmaps)
            .map_err(|e| format!("Cannot read {:?}: {}", bm_trackmaps, e))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let entry_path = entry.path();
            if entry_path.is_file()
                && entry_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("jcm"))
                    .unwrap_or(false)
            {
                if let Some(filename) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if filename.starts_with('.') {
                        continue;
                    }
                    track_maps.push(TrackMapSummary {
                        filename: filename.to_string(),
                        path: entry_path.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    songs.sort_by(|a, b| a.folder_name.to_lowercase().cmp(&b.folder_name.to_lowercase()));
    playlists.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    track_maps.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));

    Ok(ScanResult {
        songs,
        playlists,
        track_maps,
    })
}

/// Read a UTF-8 text file. Used by the frontend to feed contents into
/// the TS-side codec library.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Cannot read '{}': {}", path, e))
}

/// Write a UTF-8 text file (overwrites if exists). Used by the frontend
/// to persist files produced by the TS-side codec library.
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("Cannot write '{}': {}", path, e))
}

// ---------------------------------------------------------------------------
// Source-files-pane support (Phase 3)
// ---------------------------------------------------------------------------

/// Audio/MIDI file in a source folder, with WAV-header info baked in
/// so the frontend doesn't have to round-trip per file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFileInfo {
    pub filename: String,
    pub path: String,
    /// File extension lowercased: "wav" or "mid".
    pub kind: String,
    /// Mono/stereo + duration etc. for WAV files. Populated even when
    /// the file has a `Warning`-severity diagnostic, since lenient
    /// header parsing can extract metadata for technically-out-of-spec
    /// files that the BandMate hardware nonetheless plays cleanly.
    /// `None` for MIDI files (no audio metadata applies) or for files
    /// with an `Error`-severity diagnostic that prevented header read.
    pub wav_info: Option<WavInfo>,
    /// Severity-classified diagnostic. `None` = clean file.
    pub diagnostic: Option<Diagnostic>,
    /// Cleanliness for MIDI files (kind == "mid"). `Some(true)` =
    /// contains only keep-list events. `Some(false)` = contains
    /// strip-list meta events that would be sent to the device on a
    /// live MIDI port (markers, key sigs, etc — see midi.rs). `None`
    /// for non-MIDI files or for MIDI files we couldn't parse.
    pub is_midi_clean: Option<bool>,
    /// File duration in seconds — populated for BOTH WAV and MIDI so
    /// the song-save flow can pick the longest media file across
    /// kinds. For WAVs this is the same value as `wav_info.duration_seconds`;
    /// for MIDI it's computed by walking the SMF events + tempo map
    /// (see `midi::duration_seconds`). `None` if we couldn't probe.
    ///
    /// Smoke-test finding F-2: before this field existed, `<length>`
    /// only considered WAV durations and could under-report when a
    /// MIDI file was the longest media in a song.
    pub duration_seconds: Option<f64>,
    /// Last-modified time as Unix epoch seconds. Surfaced in
    /// SourceFilesPane row subtitles so the user can spot the most-
    /// recent take when re-importing from a Logic export folder that
    /// accumulates multiple renders. `None` if `fs::metadata` failed.
    pub modified_seconds: Option<f64>,
    /// File size in bytes. Surfaced in the per-song "Clean up
    /// unreferenced files" confirm dialog (so the user can see how
    /// much disk they'll free) and in the USB-export "Skipping N
    /// unused file(s) (~M MB)" summary. `None` if `fs::metadata`
    /// failed.
    pub size_bytes: Option<u64>,
}

/// File-level diagnostic. We surface these in the source-files pane.
///
///   - `Warning`: file is technically out-of-spec but BandMate plays it.
///     User should re-bounce when convenient; not blocking.
///   - `Error`: file cannot be used (stereo, totally corrupt, etc.).
#[derive(Debug, Serialize)]
#[serde(tag = "severity", rename_all = "lowercase")]
pub enum Diagnostic {
    Warning { message: String },
    Error { message: String },
}

/// List `*.wav` and `*.mid` files in a folder, with WAV header info.
///
/// One Tauri call returns everything the source-files pane needs: the
/// filenames, full paths, and (for WAVs) the channel count and duration
/// so we can flag stereo files in the UI without N more roundtrips.
#[tauri::command]
fn list_audio_files(folder: String) -> Result<Vec<AudioFileInfo>, String> {
    let folder_path = Path::new(&folder);
    if !folder_path.is_dir() {
        return Err(format!("Not a directory: {}", folder));
    }

    let mut out = Vec::new();
    for entry in
        fs::read_dir(folder_path).map_err(|e| format!("Cannot read {}: {}", folder, e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Skip macOS hidden / AppleDouble files. Stock BM Loader includes
        // these in red — we just hide them entirely. dot_clean is the
        // long-term fix.
        if filename.starts_with('.') || filename.starts_with("._") {
            continue;
        }
        let ext_lower = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase());
        let kind = match ext_lower.as_deref() {
            Some("wav") => "wav",
            Some("mid") => "mid",
            _ => continue,
        };

        let path_str = path.to_string_lossy().to_string();

        let (wav_info, diagnostic) = if kind == "wav" {
            probe_wav_with_diagnostic(&path)
        } else {
            (None, None)
        };

        // is_midi_clean is computed for .mid files. Parse failures
        // → None so the badge falls through to "unknown" (no badge)
        // rather than misleadingly claiming "Not clean".
        let is_midi_clean = if kind == "mid" {
            midi::is_clean(&path).ok()
        } else {
            None
        };

        // Unified duration for both kinds — used by SongEditor's
        // longest-media calculation that writes `<length>` into
        // the .jcs. WAV duration comes from the probe; MIDI from
        // walking the SMF (see midi::duration_seconds).
        let duration_seconds = match kind {
            "wav" => wav_info.as_ref().map(|w| w.duration_seconds),
            "mid" => midi::duration_seconds(&path).ok(),
            _ => None,
        };

        // Single metadata read covers both modified_seconds and
        // size_bytes. The .duration_since can fail if mtime is before
        // the epoch — extremely unusual, surfaces as None.
        let metadata = entry.metadata().ok();
        let modified_seconds = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64());
        let size_bytes = metadata.as_ref().map(|m| m.len());

        out.push(AudioFileInfo {
            filename,
            path: path_str,
            kind: kind.to_string(),
            wav_info,
            diagnostic,
            is_midi_clean,
            duration_seconds,
            modified_seconds,
            size_bytes,
        });
    }

    out.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(out)
}

/// Probe a WAV file with severity classification. The strict path
/// (hound) handles clean files. If hound rejects the file with a
/// recoverable error — specifically the data-chunk-length mismatch
/// that the BandMate hardware tolerates — we fall back to a manual
/// header parse that extracts the spec anyway, and tag the result as
/// a `Warning` so the UI can surface it without blocking the user.
///
/// Hard errors (corrupt fmt chunk, missing chunks, non-WAVE files,
/// I/O failure) come back as `Error` with no `WavInfo`.
fn probe_wav_with_diagnostic(path: &Path) -> (Option<WavInfo>, Option<Diagnostic>) {
    match hound::WavReader::open(path) {
        Ok(reader) => {
            let spec = reader.spec();
            let duration_samples = u64::from(reader.duration());
            let duration_seconds = duration_samples as f64 / f64::from(spec.sample_rate);
            (
                Some(WavInfo {
                    channels: spec.channels,
                    sample_rate: spec.sample_rate,
                    bit_depth: spec.bits_per_sample,
                    duration_samples,
                    duration_seconds,
                }),
                None,
            )
        }
        Err(e) => {
            let msg = e.to_string();
            // The "data chunk length is not a multiple of sample size"
            // error means the file ends mid-sample (typically from a
            // region cut export). hound is strict; libsndfile (what
            // the BandMate runs) is lenient and just truncates. Eric
            // confirmed these files play fine on the unit, so we
            // demote to a Warning and recover the metadata via a
            // manual header parse.
            if msg.contains("data chunk length is not a multiple") {
                if let Ok(info) = read_wav_header_lenient(path) {
                    return (
                        Some(info),
                        Some(Diagnostic::Warning { message: msg }),
                    );
                }
            }
            (None, Some(Diagnostic::Error { message: msg }))
        }
    }
}

/// Manual minimal WAV header parser. Used as a fallback when hound's
/// strict validation rejects an otherwise-recoverable file. We walk
/// the RIFF chunks, pull `fmt ` for the spec and `data` for the
/// length, and compute duration as `data_size / frame_size` (rounded
/// down — same thing libsndfile does for these files).
fn read_wav_header_lenient(path: &Path) -> Result<WavInfo, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut riff = [0u8; 12];
    f.read_exact(&mut riff).map_err(|e| e.to_string())?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Err("not a RIFF/WAVE file".into());
    }

    let mut channels: u16 = 0;
    let mut sample_rate: u32 = 0;
    let mut bits_per_sample: u16 = 0;
    let mut data_size: u32 = 0;
    let mut found_fmt = false;
    let mut found_data = false;

    loop {
        let mut header = [0u8; 8];
        if f.read_exact(&mut header).is_err() {
            break;
        }
        let chunk_id = &header[0..4];
        let chunk_size =
            u32::from_le_bytes([header[4], header[5], header[6], header[7]]);

        if chunk_id == b"fmt " {
            // PCM `fmt ` is 16 bytes; some WAVs use 18 or 40 (for
            // WAVE_FORMAT_EXTENSIBLE). We only need the first 16.
            let to_read = chunk_size.min(40) as usize;
            let mut fmt_buf = vec![0u8; to_read];
            f.read_exact(&mut fmt_buf).map_err(|e| e.to_string())?;
            if fmt_buf.len() >= 16 {
                channels = u16::from_le_bytes([fmt_buf[2], fmt_buf[3]]);
                sample_rate = u32::from_le_bytes([
                    fmt_buf[4], fmt_buf[5], fmt_buf[6], fmt_buf[7],
                ]);
                bits_per_sample = u16::from_le_bytes([fmt_buf[14], fmt_buf[15]]);
                found_fmt = true;
            }
            // Skip any remaining fmt-chunk bytes beyond what we read.
            let leftover = chunk_size as i64 - to_read as i64;
            if leftover > 0 {
                f.seek(SeekFrom::Current(leftover))
                    .map_err(|e| e.to_string())?;
            }
            // RIFF chunks are padded to even byte alignment.
            if chunk_size % 2 == 1 {
                f.seek(SeekFrom::Current(1)).map_err(|e| e.to_string())?;
            }
        } else if chunk_id == b"data" {
            data_size = chunk_size;
            found_data = true;
            break; // We have everything we need.
        } else {
            // Skip unknown chunks (LIST/INFO etc.).
            f.seek(SeekFrom::Current(chunk_size as i64))
                .map_err(|e| e.to_string())?;
            if chunk_size % 2 == 1 {
                f.seek(SeekFrom::Current(1)).map_err(|e| e.to_string())?;
            }
        }
    }

    if !found_fmt {
        return Err("missing fmt chunk".into());
    }
    if !found_data {
        return Err("missing data chunk".into());
    }

    let bytes_per_sample = u32::from(bits_per_sample) / 8;
    let frame_size = u32::from(channels) * bytes_per_sample;
    let duration_samples = if frame_size > 0 {
        u64::from(data_size / frame_size)
    } else {
        0
    };
    let duration_seconds = if sample_rate > 0 {
        duration_samples as f64 / f64::from(sample_rate)
    } else {
        0.0
    };

    Ok(WavInfo {
        channels,
        sample_rate,
        bit_depth: bits_per_sample,
        duration_samples,
        duration_seconds,
    })
}

/// Copy a file into a folder. Returns the destination path on success.
///
/// If a file with the same name already exists in the destination, it's
/// overwritten (matches BM Loader's behavior — re-bouncing a track in
/// your DAW and re-copying just updates the song folder's copy).
#[tauri::command]
fn copy_into_folder(src: String, dest_dir: String) -> Result<String, String> {
    let src_path = Path::new(&src);
    let dest_dir_path = Path::new(&dest_dir);
    if !src_path.is_file() {
        return Err(format!("Source is not a file: {}", src));
    }
    if !dest_dir_path.is_dir() {
        // Create it if missing — convenient for new-song flow where the
        // folder hasn't been written yet.
        fs::create_dir_all(dest_dir_path)
            .map_err(|e| format!("Cannot create dest dir {}: {}", dest_dir, e))?;
    }
    let filename = src_path
        .file_name()
        .ok_or_else(|| format!("Source has no filename: {}", src))?;
    let dest_path = dest_dir_path.join(filename);
    fs::copy(src_path, &dest_path)
        .map_err(|e| format!("Cannot copy {} → {}: {}", src, dest_path.display(), e))?;
    Ok(dest_path.to_string_lossy().to_string())
}

/// Check whether a path exists on disk — file OR directory. Used by
/// the export dialog to validate a remembered USB mount path before
/// pre-selecting it (the destination is a directory, so the old
/// `is_file()` check always returned false for `/Volumes/<name>`,
/// which broke pre-selection — root cause of the 0.10.4 testing
/// report).
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

// ---------------------------------------------------------------------------
// Phase 3f — New Song wizard
// ---------------------------------------------------------------------------

/// Result of [`create_song`] — both paths the frontend will need next:
/// the folder it just made, and the .jcs file it should write into it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedSong {
    /// Absolute path of the new song folder (`bm_sources/<name>/`).
    pub folder_path: String,
    /// Absolute path the frontend should `write_text_file` the .jcs to.
    pub jcs_path: String,
}

/// Create a new song folder under `<working_folder>/bm_media/bm_sources/`.
///
/// The folder name *is* the song name — that's the BandMate convention
/// (the device shows the folder name on screen, and the .jcs filename
/// matches). This command:
///
///   1. Validates `song_name` (non-empty, no path separators, no leading
///      dot, ≤ 64 chars). We're stricter than macOS file naming because
///      this name has to round-trip through BandMate's display + the
///      .jcp parser.
///   2. Computes `bm_sources/<song_name>/` and `bm_sources/<song_name>/<song_name>.jcs`.
///   3. Errors if the song folder already exists — caller handles the
///      collision (e.g., dialog: "A song named X already exists").
///   4. Creates the folder.
///   5. Returns both paths so the frontend can write the empty .jcs and
///      then route the user into the editor.
///
/// Note: the .jcs file itself is *not* written here. The frontend's
/// codec library (`writeSong`) is the authority on .jcs format, so we
/// keep file generation on the TS side and use this command only for
/// the folder skeleton.
#[tauri::command]
fn create_song(working_folder: String, song_name: String) -> Result<CreatedSong, String> {
    // 1. Name validation. Mirror these rules in the dialog's live
    //    validator — but treat this as the source of truth.
    let trimmed = song_name.trim();
    if trimmed.is_empty() {
        return Err("Song name cannot be empty.".to_string());
    }
    if trimmed.len() > 64 {
        return Err("Song name is too long (max 64 characters).".to_string());
    }
    if trimmed.starts_with('.') {
        return Err("Song name cannot start with a dot.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Song name cannot contain '/' or '\\'.".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Song name contains an invalid character.".to_string());
    }

    // 2. Build the target paths.
    let working = Path::new(&working_folder);
    if !working.is_dir() {
        return Err(format!("Working folder is not a directory: {}", working_folder));
    }
    let sources_dir = working.join("bm_media").join("bm_sources");
    let song_dir = sources_dir.join(trimmed);
    let jcs_path = song_dir.join(format!("{}.jcs", trimmed));

    // 3. Collision check. We don't overwrite — caller should prompt the
    //    user (rename or open the existing one).
    if song_dir.exists() {
        return Err(format!("A song named '{}' already exists.", trimmed));
    }

    // 4. Create. `create_dir_all` is idempotent for the parents but
    //    this leaf directory is fresh per the check above.
    fs::create_dir_all(&song_dir)
        .map_err(|e| format!("Cannot create song folder: {}", e))?;

    Ok(CreatedSong {
        folder_path: song_dir.to_string_lossy().to_string(),
        jcs_path: jcs_path.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// Phase 4 — New Playlist wizard
// ---------------------------------------------------------------------------

/// Result of [`create_playlist`] — the path the frontend should write
/// the empty .jcp into.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedPlaylist {
    /// Absolute path the frontend should `write_text_file` the .jcp to.
    pub jcp_path: String,
}

/// Create a new (empty) playlist file under
/// `<working_folder>/bm_media/bm_sources/<name>.jcp`.
///
/// `.jcp` files live in `bm_sources/` alongside song folders — that's
/// JoeCo's BM Loader convention (see SPEC.md). The BandMate scans
/// `bm_sources/` directly for both `<song_folder>/<song>.jcs` and
/// `<playlist>.jcp` files.
///
///   1. Validates `name` (same rules as `create_song` — non-empty, no
///      slashes, no leading dot, ≤64 chars). The name doubles as the
///      .jcp filename minus the extension AND becomes the
///      <playlist_display_name> on first write.
///   2. Errors if `<name>.jcp` already exists.
///   3. Does NOT write the .jcp itself — caller writes via the codec.
#[tauri::command]
fn create_playlist(working_folder: String, name: String) -> Result<CreatedPlaylist, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Playlist name cannot be empty.".to_string());
    }
    if trimmed.len() > 64 {
        return Err("Playlist name is too long (max 64 characters).".to_string());
    }
    if trimmed.starts_with('.') {
        return Err("Playlist name cannot start with a dot.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Playlist name cannot contain '/' or '\\'.".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Playlist name contains an invalid character.".to_string());
    }

    let working = Path::new(&working_folder);
    if !working.is_dir() {
        return Err(format!("Working folder is not a directory: {}", working_folder));
    }
    let bm_sources = working.join("bm_media").join("bm_sources");
    if !bm_sources.is_dir() {
        // Defensive: shouldn't happen since init_working_folder ensures
        // bm_sources/ exists, but surface a clear error if it does.
        return Err(
            "bm_media/bm_sources/ folder is missing — re-pick the working folder.".to_string(),
        );
    }
    let jcp_path = bm_sources.join(format!("{}.jcp", trimmed));
    if jcp_path.exists() {
        return Err(format!("A playlist named '{}.jcp' already exists.", trimmed));
    }

    // Don't write the file here — codec on the TS side does that.
    // We just reserved the name (collision-checked above) and return
    // the path. There's a tiny TOCTOU window between this check and
    // the actual write, but we accept it: the worst case is a
    // surprise overwrite of a .jcp the user just created in another
    // tool, which is vanishingly unlikely in our single-user setting.

    Ok(CreatedPlaylist {
        jcp_path: jcp_path.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// "Open in Finder" — reveal a path in the OS file manager
// ---------------------------------------------------------------------------

/// Open the OS file manager and (where supported) highlight `path`.
///
/// Platform behavior:
///   - macOS:   `open -R <path>` — reveals the file in Finder, the
///              parent folder is opened with the item selected.
///   - Windows: `explorer /select,<path>` — same idea: parent folder
///              opens with the item highlighted.
///   - Linux:   no standard "select" verb across desktops, so we open
///              the parent folder via `xdg-open` and accept that the
///              item won't be highlighted. (xdg-mime / nautilus -s
///              would be Nautilus-specific.)
///
/// `path` may be a file or a folder. For a folder, the parent is
/// opened and the folder itself is highlighted (macOS / Windows).
#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Cannot open Finder: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // /select, takes a single arg (with the comma) per the docs.
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| format!("Cannot open Explorer: {}", e))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let to_open = if p.is_file() {
            p.parent().unwrap_or(p).to_path_buf()
        } else {
            p.to_path_buf()
        };
        std::process::Command::new("xdg-open")
            .arg(&to_open)
            .spawn()
            .map_err(|e| format!("Cannot open file manager: {}", e))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        Err(format!("Reveal-in-file-manager is not supported on this platform: {}", path))
    }
}

// ---------------------------------------------------------------------------
// Phase 5 — New Track Map wizard
// ---------------------------------------------------------------------------

/// Result of [`create_track_map`].
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedTrackMap {
    /// Absolute path the frontend should `write_text_file` the .jcm to.
    pub jcm_path: String,
}

/// Reserve a `.jcm` filename under
/// `<working_folder>/bm_media/bm_trackmaps/`.
///
///   1. Validates `name` (same rules as create_song / create_playlist).
///   2. Errors if `<name>.jcm` already exists.
///   3. Does NOT write the .jcm itself — caller writes via the codec.
#[tauri::command]
fn create_track_map(working_folder: String, name: String) -> Result<CreatedTrackMap, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Track-map name cannot be empty.".to_string());
    }
    if trimmed.len() > 64 {
        return Err("Track-map name is too long (max 64 characters).".to_string());
    }
    if trimmed.starts_with('.') {
        return Err("Track-map name cannot start with a dot.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Track-map name cannot contain '/' or '\\'.".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Track-map name contains an invalid character.".to_string());
    }

    let working = Path::new(&working_folder);
    if !working.is_dir() {
        return Err(format!("Working folder is not a directory: {}", working_folder));
    }
    let bm_trackmaps = working.join("bm_media").join("bm_trackmaps");
    if !bm_trackmaps.is_dir() {
        return Err(
            "bm_media/bm_trackmaps/ folder is missing — re-pick the working folder.".to_string(),
        );
    }
    let jcm_path = bm_trackmaps.join(format!("{}.jcm", trimmed));
    if jcm_path.exists() {
        return Err(format!("A track map named '{}.jcm' already exists.", trimmed));
    }

    Ok(CreatedTrackMap {
        jcm_path: jcm_path.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// Phase 4 — Delete + Duplicate operations
// ---------------------------------------------------------------------------
//
// Each operation is type-specific (delete_song / delete_playlist /
// delete_track_map, etc.) rather than a single `delete_path` so we can
// validate locations and shapes before touching disk. The TS side
// is responsible for any cross-reference cleanup before calling these
// (e.g., remove a song from playlists, then call delete_song).

/// Recursively delete a song's folder and contents.
///
/// Path validation: we require the folder to live inside
/// `<working_folder>/bm_media/bm_sources/`, to avoid any chance of
/// the frontend sending a path it shouldn't be touching.
#[tauri::command]
fn delete_song(working_folder: String, song_folder: String) -> Result<(), String> {
    let working = Path::new(&working_folder);
    let target = Path::new(&song_folder);
    let expected_parent = working.join("bm_media").join("bm_sources");
    if !target.starts_with(&expected_parent) {
        return Err(format!(
            "Refusing to delete: '{}' is not inside bm_sources/.",
            song_folder
        ));
    }
    if !target.is_dir() {
        return Err(format!("Not a directory: {}", song_folder));
    }
    fs::remove_dir_all(target).map_err(|e| format!("Cannot delete song: {}", e))
}

/// Delete a single `.jcp` playlist file.
///
/// Path safety: must live under `bm_media/bm_sources/` (the canonical
/// .jcp location per SPEC). If a stray .jcp exists elsewhere under
/// `bm_media/` from a buggy earlier build, the user should move it
/// manually rather than us silently deleting from any subfolder.
#[tauri::command]
fn delete_playlist(working_folder: String, jcp_path: String) -> Result<(), String> {
    let working = Path::new(&working_folder);
    let target = Path::new(&jcp_path);
    let expected_parent = working.join("bm_media").join("bm_sources");
    if !target.starts_with(&expected_parent) {
        return Err(format!(
            "Refusing to delete: '{}' is not inside bm_media/bm_sources/.",
            jcp_path
        ));
    }
    if !target.is_file() || target.extension().and_then(|s| s.to_str()) != Some("jcp") {
        return Err(format!("Not a .jcp file: {}", jcp_path));
    }
    fs::remove_file(target).map_err(|e| format!("Cannot delete playlist: {}", e))
}

/// Delete one or more audio/MIDI files from a song folder.
///
/// Used by the "Clean up unreferenced files" action on the Song
/// Folder tab. The TS side already classifies which filenames are
/// safe to delete (everything not in the song's .jcs `<file>` or
/// `<midi_file>` references) and passes them here as basenames.
///
/// Path safety:
///   - `song_folder` must live under
///     `<working_folder>/bm_media/bm_sources/`. We refuse otherwise.
///   - Each filename must be a bare basename (no `/`, no `\`, no
///     `..`). The frontend never sends paths, but defending against
///     traversal is cheap.
///   - Each resolved path must still be inside the song folder
///     after joining (belt + suspenders against the basename
///     check above).
///   - Only `.wav` and `.mid` files are deletable here. The .jcs
///     file itself, the `.bandmate-studio.json` sidecar, and any
///     hidden files are untouchable through this command — they
///     fall outside the cleanup scope by design.
///
/// Returns the list of files that were actually deleted. On a per-
/// file error we stop and return the error; partial success means
/// the user can re-run the action against whatever remained.
#[tauri::command]
fn delete_files_in_song_folder(
    working_folder: String,
    song_folder: String,
    filenames: Vec<String>,
) -> Result<Vec<String>, String> {
    let working = Path::new(&working_folder);
    let target_dir = Path::new(&song_folder);
    let expected_parent = working.join("bm_media").join("bm_sources");
    if !target_dir.starts_with(&expected_parent) {
        return Err(format!(
            "Refusing to clean: '{}' is not inside bm_sources/.",
            song_folder
        ));
    }
    if !target_dir.is_dir() {
        return Err(format!("Not a directory: {}", song_folder));
    }

    let mut deleted = Vec::with_capacity(filenames.len());
    for raw_name in filenames {
        let name = raw_name.trim();
        if name.is_empty() {
            return Err("Empty filename in delete list.".to_string());
        }
        if name.contains('/') || name.contains('\\') || name.contains('\0') {
            return Err(format!("Invalid filename: '{}'", name));
        }
        if name.starts_with('.') {
            return Err(format!(
                "Refusing to delete dotfile '{}' via cleanup.",
                name
            ));
        }
        let path = target_dir.join(name);
        // Re-confirm the resolved path stays inside the song folder.
        // (canonicalize() is too eager here — it follows symlinks. The
        // basename check above plus this prefix check are sufficient
        // against a malicious frontend, which we don't have anyway.)
        if !path.starts_with(target_dir) {
            return Err(format!(
                "Refusing to delete: '{}' escapes the song folder.",
                name
            ));
        }
        let ext_lower = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase());
        match ext_lower.as_deref() {
            Some("wav") | Some("mid") => {}
            _ => {
                return Err(format!(
                    "Refusing to delete '{}': only .wav and .mid files can be cleaned.",
                    name
                ));
            }
        }
        if !path.is_file() {
            // Already gone — treat as deleted and move on rather than
            // erroring out partway through a batch.
            deleted.push(name.to_string());
            continue;
        }
        fs::remove_file(&path).map_err(|e| {
            format!("Cannot delete '{}': {}", name, e)
        })?;
        deleted.push(name.to_string());
    }
    Ok(deleted)
}

/// Delete a single `.jcm` track-map file.
#[tauri::command]
fn delete_track_map(working_folder: String, jcm_path: String) -> Result<(), String> {
    let working = Path::new(&working_folder);
    let target = Path::new(&jcm_path);
    let expected_parent = working.join("bm_media").join("bm_trackmaps");
    if !target.starts_with(&expected_parent) {
        return Err(format!(
            "Refusing to delete: '{}' is not inside bm_trackmaps/.",
            jcm_path
        ));
    }
    if !target.is_file() || target.extension().and_then(|s| s.to_str()) != Some("jcm") {
        return Err(format!("Not a .jcm file: {}", jcm_path));
    }
    fs::remove_file(target).map_err(|e| format!("Cannot delete track map: {}", e))
}

/// Duplicate a song folder. Copies the entire folder + all WAVs + .jcs,
/// renaming the inner `.jcs` to match the new folder name.
///
/// The TS-side caller is expected to derive `new_name` (typically by
/// finding the lowest unused "Foo N" suffix) and to handle any
/// .jcs-internal edits via a follow-up read/parse/write pass if the
/// .jcs format ever stores the song name internally.
#[tauri::command]
fn duplicate_song(
    working_folder: String,
    source_name: String,
    new_name: String,
) -> Result<CreatedSong, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("New song name cannot be empty.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Song name cannot contain '/' or '\\'.".to_string());
    }
    let working = Path::new(&working_folder);
    let sources = working.join("bm_media").join("bm_sources");
    let src_dir = sources.join(&source_name);
    let dst_dir = sources.join(trimmed);
    if !src_dir.is_dir() {
        return Err(format!("Source song '{}' not found.", source_name));
    }
    if dst_dir.exists() {
        return Err(format!("A song named '{}' already exists.", trimmed));
    }
    copy_dir_recursive(&src_dir, &dst_dir)
        .map_err(|e| format!("Cannot duplicate song: {}", e))?;
    // Rename the inner .jcs (named after the source) to match the new
    // folder name. We do this on a best-effort basis: if the source
    // folder doesn't follow the convention, just leave the .jcs alone.
    let old_jcs = dst_dir.join(format!("{}.jcs", source_name));
    let new_jcs = dst_dir.join(format!("{}.jcs", trimmed));
    if old_jcs.is_file() {
        fs::rename(&old_jcs, &new_jcs)
            .map_err(|e| format!("Cannot rename inner .jcs: {}", e))?;
    }
    Ok(CreatedSong {
        folder_path: dst_dir.to_string_lossy().to_string(),
        jcs_path: new_jcs.to_string_lossy().to_string(),
    })
}

/// Duplicate a `.jcp` to a new filename in the same folder. Caller
/// supplies the new filename (without `.jcp` — we add it).
#[tauri::command]
fn duplicate_playlist(
    working_folder: String,
    source_path: String,
    new_name: String,
) -> Result<CreatedPlaylist, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("New playlist name cannot be empty.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Playlist name cannot contain '/' or '\\'.".to_string());
    }
    let working = Path::new(&working_folder);
    let src = Path::new(&source_path);
    if !src.is_file() {
        return Err(format!("Source playlist not found: {}", source_path));
    }
    let dst = working
        .join("bm_media")
        .join("bm_sources")
        .join(format!("{}.jcp", trimmed));
    if dst.exists() {
        return Err(format!("A playlist named '{}.jcp' already exists.", trimmed));
    }
    fs::copy(src, &dst).map_err(|e| format!("Cannot duplicate playlist: {}", e))?;
    Ok(CreatedPlaylist {
        jcp_path: dst.to_string_lossy().to_string(),
    })
}

/// Duplicate a `.jcm` track map to a new filename.
#[tauri::command]
fn duplicate_track_map(
    working_folder: String,
    source_path: String,
    new_name: String,
) -> Result<String, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("New track-map name cannot be empty.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Track-map name cannot contain '/' or '\\'.".to_string());
    }
    let working = Path::new(&working_folder);
    let src = Path::new(&source_path);
    if !src.is_file() {
        return Err(format!("Source track map not found: {}", source_path));
    }
    let dst = working
        .join("bm_media")
        .join("bm_trackmaps")
        .join(format!("{}.jcm", trimmed));
    if dst.exists() {
        return Err(format!("A track map named '{}.jcm' already exists.", trimmed));
    }
    fs::copy(src, &dst).map_err(|e| format!("Cannot duplicate track map: {}", e))?;
    Ok(dst.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Phase 4 — Rename operations
// ---------------------------------------------------------------------------
//
// Each rename command is responsible only for moving the file/folder
// on disk. Cross-reference updates (rewriting `<song_name>` /
// `<trackmap>` entries in `.jcp` files) happen on the TS side BEFORE
// these commands are called, so the codec stays the single source of
// truth on file format.

/// Rename a song's folder + its inner `.jcs` to match the new name.
/// Returns the new folder + .jcs paths.
#[tauri::command]
fn rename_song(
    working_folder: String,
    old_name: String,
    new_name: String,
) -> Result<CreatedSong, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Song name cannot be empty.".to_string());
    }
    if trimmed.len() > 64 {
        return Err("Song name is too long (max 64 characters).".to_string());
    }
    if trimmed.starts_with('.') {
        return Err("Song name cannot start with a dot.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Song name cannot contain '/' or '\\'.".to_string());
    }
    if trimmed == old_name.trim() {
        return Err("New name is the same as the current name.".to_string());
    }

    let working = Path::new(&working_folder);
    let sources = working.join("bm_media").join("bm_sources");
    let old_dir = sources.join(&old_name);
    let new_dir = sources.join(trimmed);
    if !old_dir.is_dir() {
        return Err(format!("Source song '{}' not found.", old_name));
    }
    if new_dir.exists() {
        return Err(format!("A song named '{}' already exists.", trimmed));
    }

    // Rename the folder.
    fs::rename(&old_dir, &new_dir)
        .map_err(|e| format!("Cannot rename song folder: {}", e))?;

    // Rename the inner .jcs to match. Best-effort: if there's no
    // <old_name>.jcs (e.g. the song folder didn't follow the
    // convention), just leave whatever's there alone.
    let old_jcs = new_dir.join(format!("{}.jcs", old_name));
    let new_jcs = new_dir.join(format!("{}.jcs", trimmed));
    if old_jcs.is_file() {
        fs::rename(&old_jcs, &new_jcs)
            .map_err(|e| format!("Cannot rename inner .jcs: {}", e))?;
    }

    Ok(CreatedSong {
        folder_path: new_dir.to_string_lossy().to_string(),
        jcs_path: new_jcs.to_string_lossy().to_string(),
    })
}

/// Rename a `.jcp` playlist file. The TS side is responsible for
/// updating the `<playlist_display_name>` inside the file before
/// calling this (write-old-then-rename pattern).
#[tauri::command]
fn rename_playlist(
    working_folder: String,
    old_path: String,
    new_name: String,
) -> Result<CreatedPlaylist, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Playlist name cannot be empty.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Playlist name cannot contain '/' or '\\'.".to_string());
    }
    let working = Path::new(&working_folder);
    let src = Path::new(&old_path);
    if !src.is_file() {
        return Err(format!("Source playlist not found: {}", old_path));
    }
    let dst = working
        .join("bm_media")
        .join("bm_sources")
        .join(format!("{}.jcp", trimmed));
    if dst == src {
        return Err("New name is the same as the current name.".to_string());
    }
    if dst.exists() {
        return Err(format!("A playlist named '{}.jcp' already exists.", trimmed));
    }
    fs::rename(src, &dst).map_err(|e| format!("Cannot rename playlist: {}", e))?;
    Ok(CreatedPlaylist {
        jcp_path: dst.to_string_lossy().to_string(),
    })
}

/// Rename a `.jcm` track-map file. Returns the new path.
#[tauri::command]
fn rename_track_map(
    working_folder: String,
    old_path: String,
    new_name: String,
) -> Result<String, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Track-map name cannot be empty.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Track-map name cannot contain '/' or '\\'.".to_string());
    }
    let working = Path::new(&working_folder);
    let src = Path::new(&old_path);
    if !src.is_file() {
        return Err(format!("Source track map not found: {}", old_path));
    }
    let dst = working
        .join("bm_media")
        .join("bm_trackmaps")
        .join(format!("{}.jcm", trimmed));
    if dst == src {
        return Err("New name is the same as the current name.".to_string());
    }
    if dst.exists() {
        return Err(format!("A track map named '{}.jcm' already exists.", trimmed));
    }
    fs::rename(src, &dst).map_err(|e| format!("Cannot rename track map: {}", e))?;
    Ok(dst.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Track-map import (cross-folder)
// ---------------------------------------------------------------------------
//
// Two commands work together to support importing a `.jcm` from a
// different working folder (or any folder, really) into the current one:
//
//   - `list_track_maps_in_folder` scans an arbitrary folder for .jcm files
//     and returns metadata so the import dialog can show a pickable list.
//   - `import_track_map` copies a single .jcm into the current working
//     folder's `bm_trackmaps/`. The TS side detects name collisions
//     against the active scan and decides on the final destination
//     filename + whether to overwrite, so this command stays mechanical.
//
// .jcm files are self-contained — no per-trackmap sidecar metadata to
// copy alongside (the `.bandmate-studio.json` sidecar is per-song only).

/// One `.jcm` file found in an external folder, surfaced to the import
/// dialog so it can render a pickable list with enough info for the
/// user to disambiguate similarly-named files.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTrackMap {
    /// Filename including extension, e.g. "stems_tm.jcm".
    pub filename: String,
    /// Absolute path to the .jcm file in the source folder.
    pub path: String,
    /// Size in bytes (best-effort; 0 if metadata read fails).
    pub size_bytes: u64,
    /// Last-modified time as Unix epoch seconds (best-effort; None on
    /// pre-epoch or unreadable mtime).
    pub modified_seconds: Option<f64>,
}

/// Enumerate `.jcm` files inside the given folder's `bm_media/bm_trackmaps/`.
/// Accepts either a working-folder root (with the standard layout) OR a
/// raw folder that contains .jcm files directly — we look in the standard
/// location first, then fall back to scanning the folder itself. This
/// keeps the picker flexible: users can either point at another working
/// folder OR at an ad-hoc folder full of `.jcm` exports.
///
/// Sorted alphabetically. Hidden files (leading dot) and non-.jcm files
/// are skipped. Missing folders return an empty list rather than erroring
/// so the dialog can show a "no track maps here" empty state.
#[tauri::command]
fn list_track_maps_in_folder(folder: String) -> Result<Vec<RemoteTrackMap>, String> {
    let root = Path::new(&folder);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", folder));
    }

    // Prefer the standard layout when present; otherwise fall through to
    // the folder itself. This way users can point at either a working
    // folder root or a folder of loose `.jcm` files.
    let scan_dir = {
        let standard = root.join("bm_media").join("bm_trackmaps");
        if standard.is_dir() {
            standard
        } else {
            root.to_path_buf()
        }
    };

    let mut out = Vec::new();
    for entry in fs::read_dir(&scan_dir)
        .map_err(|e| format!("Cannot read {:?}: {}", scan_dir, e))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }
        let is_jcm = entry_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("jcm"))
            .unwrap_or(false);
        if !is_jcm {
            continue;
        }
        let filename = match entry_path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        let metadata = entry.metadata().ok();
        let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_seconds = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64());
        out.push(RemoteTrackMap {
            filename,
            path: entry_path.to_string_lossy().to_string(),
            size_bytes,
            modified_seconds,
        });
    }

    out.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
    Ok(out)
}

/// Copy a `.jcm` file into the current working folder's
/// `bm_media/bm_trackmaps/` under the caller-specified filename.
///
/// The TS side is responsible for:
///   1. Detecting name collisions (it already has the current scan).
///   2. Letting the user choose Overwrite / Rename / Skip.
///   3. Either calling this with `overwrite = true`, supplying a renamed
///      `dest_filename`, or not calling at all (skip).
///
/// This command's job is narrow: validate inputs, ensure the trackmaps
/// folder exists, and copy. Returns the destination path on success.
#[tauri::command]
fn import_track_map(
    src_path: String,
    dest_working_folder: String,
    dest_filename: String,
    overwrite: bool,
) -> Result<String, String> {
    let trimmed = dest_filename.trim();
    if trimmed.is_empty() {
        return Err("Destination filename cannot be empty.".to_string());
    }
    if trimmed.starts_with('.') {
        return Err("Destination filename cannot start with a dot.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Destination filename cannot contain '/' or '\\'.".to_string());
    }
    if !trimmed.to_lowercase().ends_with(".jcm") {
        return Err("Destination filename must end with .jcm.".to_string());
    }

    let src = Path::new(&src_path);
    if !src.is_file() {
        return Err(format!("Source track map not found: {}", src_path));
    }
    let src_is_jcm = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("jcm"))
        .unwrap_or(false);
    if !src_is_jcm {
        return Err(format!("Source is not a .jcm file: {}", src_path));
    }

    let working = Path::new(&dest_working_folder);
    if !working.is_dir() {
        return Err(format!(
            "Destination working folder is not a directory: {}",
            dest_working_folder
        ));
    }
    let bm_trackmaps = working.join("bm_media").join("bm_trackmaps");
    // Mirror `create_track_map`: require the standard subtree to exist
    // so we never silently create a new layout in a folder that isn't a
    // BandMate working folder.
    if !bm_trackmaps.is_dir() {
        return Err(
            "bm_media/bm_trackmaps/ folder is missing — re-pick the working folder.".to_string(),
        );
    }

    let dst = bm_trackmaps.join(trimmed);
    if dst.exists() && !overwrite {
        return Err(format!(
            "A track map named '{}' already exists.",
            trimmed
        ));
    }
    if dst == src {
        return Err(
            "Source and destination are the same file — pick a different folder or filename."
                .to_string(),
        );
    }
    fs::copy(src, &dst).map_err(|e| format!("Cannot import track map: {}", e))?;
    Ok(dst.to_string_lossy().to_string())
}

/// Recursive copy helper for `duplicate_song`. Std lib doesn't ship
/// one; this is a small DFS that copies directory entries.
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if kind.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if kind.is_file() {
            fs::copy(&from, &to)?;
        }
        // Symlinks etc. are silently ignored — none expected in
        // bm_sources/.
    }
    Ok(())
}

/// Read the per-song sidecar metadata file (`.bandmate-studio.json`) that
/// stores BandMate Studio-only state — currently just the external source
/// folder. Returns `None` if the sidecar is missing (the common case for
/// existing songs that predate the wizard).
///
/// Keeping this in a sidecar file (not app prefs) means the metadata
/// travels with the song folder when the user moves their working folder,
/// and the dotfile prefix means the BandMate hardware ignores it.
#[tauri::command]
fn read_song_sidecar(song_folder: String) -> Result<Option<String>, String> {
    let path = Path::new(&song_folder).join(".bandmate-studio.json");
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Cannot read sidecar: {}", e))
}

/// Write the per-song sidecar metadata file. Caller passes the JSON
/// content as a string — we let the TS side own the schema so adding
/// fields doesn't require Rust changes.
#[tauri::command]
fn write_song_sidecar(song_folder: String, content: String) -> Result<(), String> {
    let dir = Path::new(&song_folder);
    if !dir.is_dir() {
        return Err(format!("Song folder is not a directory: {}", song_folder));
    }
    let path = dir.join(".bandmate-studio.json");
    fs::write(&path, content).map_err(|e| format!("Cannot write sidecar: {}", e))
}

// ---------------------------------------------------------------------------
// Phase 6 — USB Export
// ---------------------------------------------------------------------------

/// Per-file progress event emitted during `export_to_usb`. The
/// frontend subscribes to the "export-progress" event channel and
/// updates the export dialog's progress bar as files arrive.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    /// Filename currently being copied (just the basename).
    pub current_file: String,
    pub files_copied: u64,
    pub total_files: u64,
    pub bytes_copied: u64,
    pub total_bytes: u64,
}

/// Summary returned when `export_to_usb` completes (successfully or
/// canceled — failures still surface as `Err(String)`). The JS side
/// disambiguates "completed" vs "canceled" via `was_canceled` and
/// uses the totals to drive the Success terminal state's footer copy
/// ("Copied 4.2 GB in 3 minutes 18 seconds").
///
/// The `*_added` / `*_updated` counts answer the question "what
/// landed on the stick that wasn't there before, vs what was
/// overwritten with newer content from the working folder." Added =
/// destination path did not exist before this export started.
/// Updated = destination existed and we wrote over it. Songs are
/// tracked at the folder level (any file write inside the song
/// folder counts the song once); playlists / trackmaps at the
/// individual-file level. Files we never wrote (filtered out, or
/// in a partial cancel run we didn't reach) don't appear in either.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub files_copied: u64,
    pub bytes_copied: u64,
    pub total_files: u64,
    pub total_bytes: u64,
    /// True if `dot_clean -m` ran (macOS only).
    pub dot_cleaned: bool,
    /// True if the export was halted by a `cancel_export` call. The
    /// summary fields reflect what landed on the USB before the
    /// cancel was honored — partial state. JS surfaces a "Canceled"
    /// terminal state with copy that warns the stick may be
    /// inconsistent (PR1 cancellation policy (a) — no rollback).
    pub was_canceled: bool,
    /// Wall-clock duration of the export in milliseconds, from start
    /// of the copy through dot_clean. Used by the Success / Canceled
    /// terminal states' summary footer.
    pub elapsed_ms: u64,
    pub songs_added: u64,
    pub songs_updated: u64,
    pub playlists_added: u64,
    pub playlists_updated: u64,
    pub trackmaps_added: u64,
    pub trackmaps_updated: u64,
    /// True if this export ran with the incremental flag on, i.e.
    /// skipped files whose size+mtime matched the destination. The
    /// JS side conditionally shows a "N files unchanged" line on
    /// the Success screen based on this — full exports never have
    /// "unchanged" semantics (everything was rewritten by design).
    pub was_incremental: bool,
    /// Count of files that were skipped because their size + mtime
    /// matched the existing destination file. Always 0 unless
    /// `was_incremental` is true.
    pub files_unchanged: u64,
    /// True if `dest_path` resolves to a removable volume that
    /// `eject_volume` could plausibly act on. False for the internal
    /// system disk or any non-removable destination — the JS side
    /// disables the Eject button when this is false (with a tooltip
    /// explaining why) so the user doesn't get a confusing error
    /// from `diskutil eject` against a non-ejectable path.
    pub is_ejectable: bool,
}

/// Accumulator threaded through `copy_tree_with_progress`. The
/// added-vs-updated distinction is captured at the right moment in
/// the recursion: songs at folder entry (before we mkdir the
/// destination), playlists/trackmaps at file copy (before fs::copy
/// runs). Songs use HashSet so a song folder with multiple files
/// in the same export only contributes once to the tally.
#[derive(Default)]
struct ExportTallies {
    songs_added: HashSet<String>,
    songs_updated: HashSet<String>,
    playlists_added: u64,
    playlists_updated: u64,
    trackmaps_added: u64,
    trackmaps_updated: u64,
    /// Bumped each time the incremental skip kicks in (dest exists,
    /// size matches, mtime matches within the FS-resolution
    /// tolerance). 0 when incremental mode is off.
    files_unchanged: u64,
}

/// Classifies a destination path inside `bm_media/` into the role
/// that drives the added/updated tally. Anything outside
/// `bm_media/` (shouldn't happen — we only copy under bm_media) or
/// a file that doesn't match one of the three known patterns
/// returns `Other` and is ignored by the tally.
enum FileRole {
    /// Anything under `bm_media/bm_sources/<song>/...` — counted at
    /// the song-folder level, not per-file.
    SongMedia,
    /// `bm_media/bm_trackmaps/<name>.jcm` — track map definitions.
    TrackMap,
    /// `bm_media/<name>.jcp` at the bm_media root — playlists.
    Playlist,
    Other,
}

fn classify_file(dst_path: &Path, bm_media_dst: &Path) -> FileRole {
    let rel = match dst_path.strip_prefix(bm_media_dst) {
        Ok(p) => p,
        Err(_) => return FileRole::Other,
    };
    let mut components = rel.components();
    let first = match components.next() {
        Some(c) => c,
        None => return FileRole::Other,
    };
    let has_more = components.next().is_some();
    let first_str = first.as_os_str().to_str().unwrap_or("");
    let ext_lower = dst_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    if first_str == "bm_sources" {
        return FileRole::SongMedia;
    }
    if first_str == "bm_trackmaps"
        && has_more
        && ext_lower.as_deref() == Some("jcm")
    {
        return FileRole::TrackMap;
    }
    if !has_more && ext_lower.as_deref() == Some("jcp") {
        return FileRole::Playlist;
    }
    FileRole::Other
}

/// Extract a song folder name when `src` is exactly
/// `<bm_sources_src>/<song-name>`. Returns None for any other shape
/// (parent of bm_sources itself, deeper than one level, outside
/// bm_sources, etc.). Used to tally song folder added/updated at
/// recursion entry.
fn song_folder_name(src: &Path, bm_sources_src: &Path) -> Option<String> {
    let rel = src.strip_prefix(bm_sources_src).ok()?;
    let mut components = rel.components();
    let first = components.next()?;
    if components.next().is_some() {
        return None;
    }
    first.as_os_str().to_str().map(String::from)
}

/// Pre-flight result returned by `prepare_export`. The JS side renders
/// inline errors on the confirm step when `is_writable` is false or
/// `total_bytes > available_bytes` (with a small safety margin).
///
/// Both full and incremental totals are returned from a single
/// destination-aware walk so the UI can show both numbers (and the
/// "Export updates only" checkbox can toggle which one is active
/// without a re-fetch). For a fresh USB, `incremental_*` equals
/// `total_*` (everything counts as new). For a re-export to the
/// same stick after small edits, `incremental_*` is typically a
/// small fraction.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreFlight {
    pub total_files: u64,
    pub total_bytes: u64,
    /// Files that would actually be copied under incremental mode
    /// (destination doesn't exist, or size/mtime differs).
    pub incremental_files: u64,
    pub incremental_bytes: u64,
    /// Free space on the destination volume, in bytes. 0 if the
    /// volume's available space couldn't be determined (treated as
    /// non-fatal — the actual write would still error if too large).
    pub available_bytes: u64,
    /// True if a probe-file write+delete succeeded at `dest_path`.
    pub is_writable: bool,
}

/// Cooperative cancellation flag for `export_to_usb`. Set to `true`
/// by the `cancel_export` command; the copy loop checks between file
/// iterations and breaks out gracefully (mid-`fs::copy()` cancellation
/// would truncate the file currently being written, which is the
/// failure mode we're trying to PREVENT — the whole point of an
/// honest cancel button is letting the user back out without putting
/// the stick in a worse state).
///
/// Reset to `false` at the start of every `export_to_usb` call so a
/// previous canceled session doesn't poison the next one. Single
/// global because only one export runs at a time (the dialog is modal
/// and the JS side doesn't allow concurrent invocations).
static CANCEL_EXPORT: AtomicBool = AtomicBool::new(false);

/// If `src` is a song folder directly under `bm_sources_src` (i.e.
/// `bm_sources_src/<some_song_name>`), look up the allow-set for that
/// song in `filter`. Returns None if the path isn't a song folder or
/// if no filter is active or if the song isn't in the filter map.
///
/// Used by both count_tree and copy_tree_with_progress to apply the
/// "only copy referenced files" toggle. The filter map's keys are
/// song folder names (basenames); its values are sets of allowed
/// filenames pre-lowercased for case-insensitive matching.
fn song_folder_filter<'a>(
    src: &Path,
    bm_sources_src: &Path,
    filter: Option<&'a HashMap<String, HashSet<String>>>,
) -> Option<&'a HashSet<String>> {
    let filter = filter?;
    let rel = src.strip_prefix(bm_sources_src).ok()?;
    let mut components = rel.components();
    let first = components.next()?;
    // Exactly one component → this is `bm_sources/<song>` itself,
    // not something deeper. Files inside the song folder are the
    // direct iteration targets.
    if components.next().is_some() {
        return None;
    }
    let song_name = first.as_os_str().to_str()?;
    filter.get(song_name)
}

/// Decide whether a media file (.wav / .mid) inside a filtered song
/// folder should be included. Non-media files (.jcs, anything else)
/// always include because the filter only governs audio/MIDI.
fn passes_song_filter(name: &str, allowed: &HashSet<String>) -> bool {
    let path = Path::new(name);
    let ext_lower = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    let is_media = matches!(ext_lower.as_deref(), Some("wav") | Some("mid"));
    if !is_media {
        // .jcs / unknown types always copy — the filter is media-only.
        return true;
    }
    allowed.contains(&name.to_lowercase())
}

/// Aggregate result from `count_tree`. Two totals are computed in
/// the same walk so the pre-flight can show both numbers without a
/// second pass:
///   - `total_*`: files that survive the filter — what a FULL
///     export would write.
///   - `incremental_*`: subset of the above where the destination
///     file doesn't exist or its size/mtime differ — what an
///     INCREMENTAL export would actually copy.
#[derive(Default)]
struct CountResult {
    total_files: u64,
    total_bytes: u64,
    incremental_files: u64,
    incremental_bytes: u64,
}

/// Recursively count files + bytes under `src` so we can compute
/// progress percentages without re-walking. Applies the same
/// `bm_sources` song-folder allow-list as the copy pass so the
/// progress bar's "total" matches what actually gets copied. Walks
/// the corresponding `dst` in lockstep to compute the incremental
/// subset — files where the destination is missing or its
/// size/mtime indicate the source content has changed.
fn count_tree(
    src: &Path,
    dst: &Path,
    bm_sources_src: &Path,
    filter: Option<&HashMap<String, HashSet<String>>>,
) -> std::io::Result<CountResult> {
    let mut result = CountResult::default();
    if src.is_file() {
        let src_meta = src.metadata()?;
        let size = src_meta.len();
        result.total_files = 1;
        result.total_bytes = size;
        if !file_matches(&src_meta, dst) {
            result.incremental_files = 1;
            result.incremental_bytes = size;
        }
        return Ok(result);
    }
    if !src.is_dir() {
        return Ok(result);
    }
    let active_song_filter = song_folder_filter(src, bm_sources_src, filter);
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let entry_dst = dst.join(&name);
        if kind.is_dir() {
            let sub = count_tree(&entry.path(), &entry_dst, bm_sources_src, filter)?;
            result.total_files += sub.total_files;
            result.total_bytes += sub.total_bytes;
            result.incremental_files += sub.incremental_files;
            result.incremental_bytes += sub.incremental_bytes;
        } else if kind.is_file() {
            // Skip files that won't make it to USB. See
            // `is_export_excluded` for the rule list. Counting them
            // would inflate the "total" against the post-filter
            // reality.
            if is_export_excluded(&name_str) {
                continue;
            }
            if let Some(allowed) = active_song_filter {
                if !passes_song_filter(&name_str, allowed) {
                    continue;
                }
            }
            let src_meta = entry.metadata()?;
            let size = src_meta.len();
            result.total_files += 1;
            result.total_bytes += size;
            if !file_matches(&src_meta, &entry_dst) {
                result.incremental_files += 1;
                result.incremental_bytes += size;
            }
        }
    }
    Ok(result)
}

/// Returns true if the destination file looks identical to `src` —
/// same size, mtime equal within filesystem-resolution tolerance.
/// Used by incremental export to decide whether to skip a file.
///
/// **Tolerance:** 2 seconds. FAT32 stores mtimes at 2s resolution,
/// exFAT at 10ms, APFS sub-millisecond. After `fs::copy` we sync
/// dst mtime to src mtime via `File::set_modified` (so a fresh
/// copy reads back identical), but the dst FS may round down — a
/// 1.8s-resolution drift between src (APFS) and dst (FAT32-on-USB)
/// would otherwise cause every file to look "changed" on the next
/// export. 2s is the conservative ceiling.
///
/// **Reliability:** any content change rewrites bytes, which
/// updates mtime — so false negatives (treating a changed file as
/// unchanged) require modifying a file without touching its mtime,
/// which isn't possible through normal user workflows. False
/// positives (treating an unchanged file as changed) just cause an
/// unnecessary re-copy, which wastes time but never loses data.
fn file_matches(src_meta: &fs::Metadata, dst: &Path) -> bool {
    let dst_meta = match fs::metadata(dst) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if dst_meta.len() != src_meta.len() {
        return false;
    }
    let src_mtime = match src_meta.modified() {
        Ok(t) => t,
        Err(_) => return false,
    };
    let dst_mtime = match dst_meta.modified() {
        Ok(t) => t,
        Err(_) => return false,
    };
    mtimes_match(src_mtime, dst_mtime)
}

/// Absolute-difference mtime comparison with a 2-second tolerance.
/// See `file_matches` for the rationale.
fn mtimes_match(a: std::time::SystemTime, b: std::time::SystemTime) -> bool {
    let diff = match a.duration_since(b) {
        Ok(d) => d,
        Err(e) => e.duration(),
    };
    diff < std::time::Duration::from_secs(2)
}

/// Sync the destination file's mtime to the source's. Best-effort —
/// if it fails (rare; would need restrictive ACLs or an FS that
/// rejects `set_modified`), the file is still copied correctly,
/// just won't compare equal under a future incremental export and
/// would be re-copied unnecessarily.
fn sync_mtime(dst: &Path, src_meta: &fs::Metadata) {
    let Ok(src_mtime) = src_meta.modified() else {
        return;
    };
    let _ = fs::File::options()
        .write(true)
        .open(dst)
        .and_then(|f| f.set_modified(src_mtime));
}

/// True if a file should be filtered out of USB export. Three categories:
///   - macOS Finder metadata: `.DS_Store` (shows up in BandMate's
///     directory listings; harmless but ugly).
///   - AppleDouble siblings: `._foo` (created by macOS on FAT32 /
///     exFAT; the BandMate currently mixes these into the playlist
///     menu as fake entries — see Bandmate/MANUAL_ADDITIONS.md).
///   - Studio-only sidecars: `.bandmate-studio.json` (stash file for
///     per-song Studio prefs — source folder, preview trackmap. The
///     BandMate has no use for them; they also leak local Mac paths
///     to the USB stick).
fn is_export_excluded(name: &str) -> bool {
    name == ".DS_Store"
        || name == ".bandmate-studio.json"
        || name.starts_with("._")
}

/// Recursively copy `src` → `dst`, emitting per-file progress events
/// to the frontend. Skips files per `is_export_excluded` (macOS
/// metadata, AppleDouble siblings, Studio-only sidecars) — `dot_clean`
/// cleans up `._*` afterward too, but filtering during copy avoids
/// the AppleDouble files ever existing on the destination.
///
/// Cancellation: checks `CANCEL_EXPORT` between file iterations.
/// When the flag is set, returns `Ok(true)` to signal that the copy
/// halted gracefully — the caller treats this as a "canceled" terminal
/// state rather than an error. Returns `Ok(false)` on normal
/// completion. We never check mid-file (`fs::copy` is not interruptible
/// safely; a partial copy would leave a truncated file on the USB).
fn copy_tree_with_progress(
    src: &Path,
    dst: &Path,
    bm_media_dst: &Path,
    bm_sources_src: &Path,
    filter: Option<&HashMap<String, HashSet<String>>>,
    incremental: bool,
    app: &tauri::AppHandle,
    tallies: &mut ExportTallies,
    files_copied: &mut u64,
    bytes_copied: &mut u64,
    total_files: u64,
    total_bytes: u64,
) -> Result<bool, String> {
    // Capture the song-folder identity and pre-existence at recursion
    // entry — BEFORE create_dir_all might bring it into being — but
    // DON'T record it in the tally yet. Under incremental mode it's
    // common to enter a song folder, find every file unchanged, and
    // skip the whole folder; tagging at entry would inflate the
    // "songs updated" count with songs we didn't actually touch.
    // The tally happens inside the file-copy branch below, on the
    // first file we actually write into this folder.
    let song_at_this_level: Option<(String, bool)> =
        song_folder_name(src, bm_sources_src).map(|name| (name, dst.exists()));
    fs::create_dir_all(dst).map_err(|e| format!("Cannot create {:?}: {}", dst, e))?;
    let active_song_filter = song_folder_filter(src, bm_sources_src, filter);
    for entry in fs::read_dir(src).map_err(|e| format!("Cannot read {:?}: {}", src, e))? {
        if CANCEL_EXPORT.load(Ordering::SeqCst) {
            return Ok(true);
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        if is_export_excluded(&name_str) {
            continue;
        }
        // Apply the "only referenced files" filter when we're inside
        // a known song folder. Media (.wav / .mid) gets gated; .jcs and
        // anything else always copies. See `passes_song_filter`.
        if let Some(allowed) = active_song_filter {
            if !passes_song_filter(&name_str, allowed) {
                continue;
            }
        }
        let from = entry.path();
        let to = dst.join(&name);
        if kind.is_dir() {
            let canceled = copy_tree_with_progress(
                &from,
                &to,
                bm_media_dst,
                bm_sources_src,
                filter,
                incremental,
                app,
                tallies,
                files_copied,
                bytes_copied,
                total_files,
                total_bytes,
            )?;
            if canceled {
                return Ok(true);
            }
        } else if kind.is_file() {
            let src_meta = entry.metadata().map_err(|e| e.to_string())?;
            let size = src_meta.len();

            // Incremental skip: if the destination file looks
            // identical (size + mtime within tolerance), don't
            // re-copy. Counts toward `files_unchanged` so the
            // Success screen can surface "N files unchanged" and
            // the user knows the skip worked. Skipped files don't
            // contribute to `files_copied`/`bytes_copied` because
            // the progress bar's total reflects only what will be
            // copied in incremental mode.
            if incremental && file_matches(&src_meta, &to) {
                tallies.files_unchanged += 1;
                continue;
            }

            // Classify + check destination existence BEFORE the copy
            // — once fs::copy runs the file always exists, which
            // would always tag it as "updated". Songs are tallied
            // below from `song_at_this_level`, not from classify_file.
            let was_existing = to.exists();
            let role = classify_file(&to, bm_media_dst);
            fs::copy(&from, &to)
                .map_err(|e| format!("Cannot copy {:?} → {:?}: {}", from, to, e))?;
            // Sync dst mtime to src mtime so future incremental
            // exports recognize this file as unchanged. fs::copy
            // doesn't preserve mtime by default — without this, the
            // next incremental run would re-copy every file every
            // time. Best-effort; see `sync_mtime`.
            sync_mtime(&to, &src_meta);

            // Promote the song-folder identity to the firm tally on
            // the first actual file write in this folder. Subsequent
            // files in the same folder are no-ops (HashSet dedupe).
            if let Some((song_name, existed_before)) = &song_at_this_level {
                if *existed_before {
                    tallies.songs_updated.insert(song_name.clone());
                } else {
                    tallies.songs_added.insert(song_name.clone());
                }
            }

            match role {
                FileRole::Playlist => {
                    if was_existing {
                        tallies.playlists_updated += 1;
                    } else {
                        tallies.playlists_added += 1;
                    }
                }
                FileRole::TrackMap => {
                    if was_existing {
                        tallies.trackmaps_updated += 1;
                    } else {
                        tallies.trackmaps_added += 1;
                    }
                }
                FileRole::SongMedia | FileRole::Other => {}
            }
            *files_copied += 1;
            *bytes_copied += size;
            // Best-effort emit — don't fail the whole copy if the
            // event channel is gone (window closed mid-copy etc.).
            let _ = app.emit(
                "export-progress",
                ExportProgress {
                    current_file: name_str,
                    files_copied: *files_copied,
                    total_files,
                    bytes_copied: *bytes_copied,
                    total_bytes,
                },
            );
        }
    }
    Ok(false)
}

/// Run `dot_clean -m <path>` on macOS to strip `._*` AppleDouble files
/// from the destination. Returns Ok(true) on macOS, Ok(false) on
/// other platforms (silent no-op so the frontend doesn't have to
/// branch on platform).
#[allow(unused_variables)]
fn run_dot_clean(path: &Path) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("dot_clean")
            .arg("-m")
            .arg(path)
            .status()
            .map_err(|e| format!("dot_clean spawn failed: {}", e))?;
        if !status.success() {
            return Err(format!("dot_clean exited with {}", status));
        }
        return Ok(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

/// Optional per-song include filter for `export_to_usb`. Each entry
/// maps a song folder name (basename, e.g. "Diff_Test_A") to the
/// list of media filenames (`.wav` / `.mid`) that should be copied.
/// Filenames inside the song folder NOT listed here are skipped.
///
/// The TS side builds this when the `exportOnlyReferencedFiles` pref
/// is on, by walking the scan + parsing each `.jcs` and collecting
/// `<file>` + `<midi_file>` references. `.jcs` is always copied
/// regardless; only audio/MIDI inside song folders is filtered.
///
/// Pass `None` (omit / null from JS) for full-copy behavior — the
/// historical default.
#[derive(Debug, Deserialize)]
pub struct ExportIncludeFilter {
    /// Map of song folder name → allowed media filenames.
    pub songs: HashMap<String, Vec<String>>,
}

/// Copy `<working_folder>/bm_media/` to `<dest_path>/bm_media/`,
/// emitting per-file progress events on the "export-progress"
/// channel, and running `dot_clean -m <dest_path>` on macOS to strip
/// AppleDouble files.
///
/// `dest_path` is the USB mount point (or any folder); the user picks
/// it via the native folder picker on the frontend before this is
/// invoked.
///
/// `include_filter` is optional: when supplied, only files inside
/// song folders that appear in its allow-list are copied. `.jcp`
/// playlist files (at the `bm_sources/` root) and `.jcm` track
/// maps (under `bm_trackmaps/`) ship regardless because they're
/// definitions, not media.
#[tauri::command]
async fn export_to_usb(
    app: tauri::AppHandle,
    working_folder: String,
    dest_path: String,
    include_filter: Option<ExportIncludeFilter>,
    incremental: bool,
) -> Result<ExportSummary, String> {
    // Run the body on a blocking-thread pool task. Tauri's async
    // runtime workers shouldn't sit on multi-GB `fs::copy()` calls —
    // it ties up whichever worker the runtime picked and (in the
    // observed-on-macOS failure mode reported during 0.10.0 testing)
    // can manifest as a beachballing UI even though the webview's
    // main thread itself isn't blocked. spawn_blocking is the
    // documented Tauri pattern for long-running synchronous I/O.
    tauri::async_runtime::spawn_blocking(move || {
        export_to_usb_impl(app, working_folder, dest_path, include_filter, incremental)
    })
    .await
    .map_err(|e| format!("Export task did not complete: {}", e))?
}

fn export_to_usb_impl(
    app: tauri::AppHandle,
    working_folder: String,
    dest_path: String,
    include_filter: Option<ExportIncludeFilter>,
    incremental: bool,
) -> Result<ExportSummary, String> {
    let src = PathBuf::from(&working_folder).join("bm_media");
    let dst = PathBuf::from(&dest_path).join("bm_media");
    if !src.is_dir() {
        return Err(format!(
            "Working folder has no bm_media/ subfolder: {}",
            working_folder
        ));
    }
    if !Path::new(&dest_path).is_dir() {
        return Err(format!("Destination is not a directory: {}", dest_path));
    }

    // Fresh run — clear any cancel signal left over from a previous
    // export. SeqCst ordering keeps this readable against the per-file
    // loads inside the copy loop.
    CANCEL_EXPORT.store(false, Ordering::SeqCst);
    let started_at = std::time::Instant::now();

    // Lower-case the allow-list filenames once up front so the
    // hot path (per-file check inside count/copy) is a single
    // HashSet lookup, not a per-file lowercasing.
    let lowered_filter: Option<HashMap<String, HashSet<String>>> =
        include_filter.map(|f| {
            f.songs
                .into_iter()
                .map(|(song, names)| {
                    (
                        song,
                        names
                            .into_iter()
                            .map(|n| n.to_lowercase())
                            .collect::<HashSet<String>>(),
                    )
                })
                .collect()
        });
    let filter_ref = lowered_filter.as_ref();
    let bm_sources_src = src.join("bm_sources");

    // Count first so we have totals for progress calculation. The
    // walk produces BOTH the full and incremental totals; we pick
    // which one drives the progress bar based on the `incremental`
    // flag. Either way the bar reaches 100% — for a full export
    // because we copy every counted file, for an incremental export
    // because we counted only what will be copied.
    let counts = count_tree(&src, &dst, &bm_sources_src, filter_ref)
        .map_err(|e| format!("Cannot scan working folder: {}", e))?;
    let (total_files, total_bytes) = if incremental {
        (counts.incremental_files, counts.incremental_bytes)
    } else {
        (counts.total_files, counts.total_bytes)
    };

    // Initial progress event so the dialog shows totals before any
    // file has been copied.
    let _ = app.emit(
        "export-progress",
        ExportProgress {
            current_file: String::new(),
            files_copied: 0,
            total_files,
            bytes_copied: 0,
            total_bytes,
        },
    );

    let mut files_copied = 0u64;
    let mut bytes_copied = 0u64;
    let mut tallies = ExportTallies::default();
    let was_canceled = copy_tree_with_progress(
        &src,
        &dst,
        &dst,
        &bm_sources_src,
        filter_ref,
        incremental,
        &app,
        &mut tallies,
        &mut files_copied,
        &mut bytes_copied,
        total_files,
        total_bytes,
    )?;

    // Run dot_clean on any path that left files on the stick — that's
    // both the success case AND a cancellation after some files
    // already landed. Partial-with-AppleDouble would be the worst of
    // both worlds (BandMate sees the metadata cruft AND the user
    // has to re-run). On a cancel before any files copied, skip it.
    let dot_cleaned = if files_copied > 0 {
        run_dot_clean(Path::new(&dest_path))?
    } else {
        false
    };

    let elapsed_ms = started_at.elapsed().as_millis() as u64;
    let is_ejectable = is_path_ejectable(Path::new(&dest_path));
    Ok(ExportSummary {
        files_copied,
        bytes_copied,
        total_files,
        total_bytes,
        dot_cleaned,
        was_canceled,
        elapsed_ms,
        songs_added: tallies.songs_added.len() as u64,
        songs_updated: tallies.songs_updated.len() as u64,
        playlists_added: tallies.playlists_added,
        playlists_updated: tallies.playlists_updated,
        trackmaps_added: tallies.trackmaps_added,
        trackmaps_updated: tallies.trackmaps_updated,
        was_incremental: incremental,
        files_unchanged: tallies.files_unchanged,
        is_ejectable,
    })
}

/// Pre-flight check before the user commits to an export. Validates
/// (1) that the destination is writable by writing+deleting a tiny
/// probe file under it, (2) how much free space the destination
/// volume has, and (3) how many files / bytes the export would write
/// (factoring in the optional include filter so the totals match the
/// post-filter reality, same as `export_to_usb`).
///
/// Returns the raw numbers; the JS side decides what to surface
/// (e.g. "USB is full — N MB needed, M MB available") and keeps the
/// user on the confirm step.
#[tauri::command]
async fn prepare_export(
    working_folder: String,
    dest_path: String,
    include_filter: Option<ExportIncludeFilter>,
) -> Result<ExportPreFlight, String> {
    // Off the runtime worker for the same reason as `export_to_usb`
    // — count_tree is fast on a single song's bm_media/ but scales
    // with the working folder size, and the probe write touches a
    // potentially slow USB. spawn_blocking keeps the IPC bridge
    // responsive while this runs.
    tauri::async_runtime::spawn_blocking(move || {
        prepare_export_impl(working_folder, dest_path, include_filter)
    })
    .await
    .map_err(|e| format!("Pre-flight task did not complete: {}", e))?
}

fn prepare_export_impl(
    working_folder: String,
    dest_path: String,
    include_filter: Option<ExportIncludeFilter>,
) -> Result<ExportPreFlight, String> {
    let src = PathBuf::from(&working_folder).join("bm_media");
    let dst_root = PathBuf::from(&dest_path);
    if !src.is_dir() {
        return Err(format!(
            "Working folder has no bm_media/ subfolder: {}",
            working_folder
        ));
    }
    if !dst_root.is_dir() {
        return Err(format!("Destination is not a directory: {}", dest_path));
    }

    let lowered_filter: Option<HashMap<String, HashSet<String>>> =
        include_filter.map(|f| {
            f.songs
                .into_iter()
                .map(|(song, names)| {
                    (
                        song,
                        names
                            .into_iter()
                            .map(|n| n.to_lowercase())
                            .collect::<HashSet<String>>(),
                    )
                })
                .collect()
        });
    let bm_sources_src = src.join("bm_sources");
    let dst = dst_root.join("bm_media");
    let counts = count_tree(&src, &dst, &bm_sources_src, lowered_filter.as_ref())
        .map_err(|e| format!("Cannot scan working folder: {}", e))?;

    // Probe: write+delete a tiny file. We deliberately use a
    // distinctive name and the dest_path root (not the bm_media/
    // subtree, which may not exist yet on a fresh stick) — the
    // probe should test writability of the volume itself.
    let probe_path = dst_root.join(".bms_writable_probe");
    let is_writable = match fs::write(&probe_path, b"bms") {
        Ok(_) => {
            // Don't surface a delete failure — the file is harmless
            // (3 bytes, dotfile, will be stripped by dot_clean on
            // export anyway). Writability is what we cared about.
            let _ = fs::remove_file(&probe_path);
            true
        }
        Err(_) => false,
    };

    // sysinfo: enumerate disks and find the one whose mount point
    // is the closest prefix of `dest_path`. On macOS this is the
    // /Volumes/<name> mount; sysinfo returns each mount as a Disk.
    let available_bytes = available_space_for(&dst_root);

    Ok(ExportPreFlight {
        total_files: counts.total_files,
        total_bytes: counts.total_bytes,
        incremental_files: counts.incremental_files,
        incremental_bytes: counts.incremental_bytes,
        available_bytes,
        is_writable,
    })
}

/// Signal a running `export_to_usb` to halt at the next file boundary.
/// Cooperative — never interrupts a `fs::copy()` mid-stream because
/// the OS could leave a truncated file on the destination. The actual
/// halt happens between files, usually within a few hundred ms on a
/// USB stick.
#[tauri::command]
fn cancel_export() {
    CANCEL_EXPORT.store(true, Ordering::SeqCst);
}

/// Free space on the volume containing `path`. Walks the sysinfo
/// disk list and picks the disk whose mount_point is the longest
/// prefix of `path` (handles macOS where every external volume
/// mounts under /Volumes/<name>). Returns 0 if no disk matches —
/// treated as "unknown; let the actual write surface the failure"
/// rather than blocking the export.
fn available_space_for(path: &Path) -> u64 {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut best: Option<(usize, u64)> = None;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if path.starts_with(mount) {
            let len = mount.as_os_str().len();
            let available = disk.available_space();
            match best {
                Some((cur_len, _)) if cur_len >= len => {}
                _ => best = Some((len, available)),
            }
        }
    }
    best.map(|(_, b)| b).unwrap_or(0)
}

/// Whether `eject_volume` could plausibly act on the volume
/// containing `path`. Resolves the matching sysinfo disk (longest
/// mount-point prefix, same approach as `available_space_for`) and
/// returns its `is_removable()`. The boot disk is not removable and
/// will return false — calling `diskutil eject` against it would
/// error anyway. USB sticks and SD cards report as removable on
/// macOS, which is the common case BMS cares about.
///
/// Edge case worth noting: external Thunderbolt SSDs that are
/// technically ejectable via `diskutil` but report as
/// non-removable will return false here. Acceptable tradeoff vs
/// surfacing a confusing error on the system disk. Revisit if it
/// becomes a workflow blocker.
fn is_path_ejectable(path: &Path) -> bool {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut best: Option<(usize, bool)> = None;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if path.starts_with(mount) {
            let len = mount.as_os_str().len();
            let removable = disk.is_removable();
            match best {
                Some((cur_len, _)) if cur_len >= len => {}
                _ => best = Some((len, removable)),
            }
        }
    }
    best.map(|(_, r)| r).unwrap_or(false)
}

/// Eject the volume mounted at `path` (macOS only).
///
/// Calls `diskutil eject <path>`. On other platforms returns Ok(false)
/// — Linux uses `umount`, Windows uses different APIs, both of which
/// usually need elevated privileges. The frontend treats false as
/// "platform doesn't auto-eject; tell the user to eject manually."
///
/// Wrapped in `spawn_blocking` because `diskutil eject` can take
/// several seconds (macOS flushes pending writes to the volume) and
/// running it on the Tauri runtime worker would tie that worker up
/// — same fix as `export_to_usb`. The frontend renders an
/// indeterminate "Ejecting…" state while this awaits.
#[tauri::command]
async fn eject_volume(path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || eject_volume_impl(path))
        .await
        .map_err(|e| format!("Eject task did not complete: {}", e))?
}

fn eject_volume_impl(path: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("diskutil")
            .arg("eject")
            .arg(&path)
            .status()
            .map_err(|e| format!("diskutil spawn failed: {}", e))?;
        if !status.success() {
            return Err(format!("diskutil exited with {}", status));
        }
        return Ok(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Ok(false)
    }
}

// ---------------------------------------------------------------------------
// MIDI cleaning (Phase 7)
// ---------------------------------------------------------------------------

/// Rewrite a MIDI file in place, removing non-essential meta events
/// that would otherwise reach the device on a live MIDI port. Atomic:
/// the cleaned bytes go to a temp file, get re-parsed for sanity, then
/// rename over the original. See midi.rs for the keep/strip rules.
///
/// No-op if the file is already clean (returns `was_modified: false`).
#[tauri::command]
fn clean_midi_file(path: String) -> Result<midi::CleanResult, String> {
    midi::clean(Path::new(&path))
}

/// Probe a single MIDI file for cleanliness. Used for one-off checks
/// outside the `list_audio_files` flow (e.g., re-checking after a
/// manual clean from the UI). Parse failures surface as `Err`.
#[tauri::command]
fn is_midi_clean(path: String) -> Result<bool, String> {
    midi::is_clean(Path::new(&path))
}

// ---------------------------------------------------------------------------
// Tauri runtime entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            probe_wav,
            init_working_folder,
            scan_working_folder,
            read_text_file,
            write_text_file,
            list_audio_files,
            copy_into_folder,
            path_exists,
            create_song,
            read_song_sidecar,
            write_song_sidecar,
            create_playlist,
            create_track_map,
            reveal_in_file_manager,
            export_to_usb,
            prepare_export,
            cancel_export,
            eject_volume,
            delete_song,
            delete_playlist,
            delete_track_map,
            delete_files_in_song_folder,
            duplicate_song,
            duplicate_playlist,
            duplicate_track_map,
            rename_song,
            rename_playlist,
            rename_track_map,
            list_track_maps_in_folder,
            import_track_map,
            clean_midi_file,
            is_midi_clean,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
