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
use std::fs;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
