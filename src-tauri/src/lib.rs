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

use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

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
/// `path`. Idempotent — safe to call on an already-initialized folder.
#[tauri::command]
fn init_working_folder(path: String) -> Result<(), String> {
    let bm_media = Path::new(&path).join("bm_media");
    fs::create_dir_all(bm_media.join("bm_sources"))
        .map_err(|e| format!("Cannot create bm_sources under '{}': {}", path, e))?;
    fs::create_dir_all(bm_media.join("bm_trackmaps"))
        .map_err(|e| format!("Cannot create bm_trackmaps under '{}': {}", path, e))?;
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

        out.push(AudioFileInfo {
            filename,
            path: path_str,
            kind: kind.to_string(),
            wav_info,
            diagnostic,
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

/// Check whether a file already exists. Used by the song editor to
/// decide whether a newly-assigned file needs copying into the song
/// folder (vs. one that's already there).
#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
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
            file_exists,
            create_song,
            read_song_sidecar,
            write_song_sidecar,
            create_playlist,
            delete_song,
            delete_playlist,
            delete_track_map,
            duplicate_song,
            duplicate_playlist,
            duplicate_track_map,
            rename_song,
            rename_playlist,
            rename_track_map,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
