// BandMate Studio — Rust backend (Tauri commands)
//
// Phase 1 commands:
//   - greet: scaffold sanity check (Phase 0 carry-forward)
//   - probe_wav: read a WAV header to get channels, sample rate, bit
//     depth, duration. Used by the song editor to detect stereo source
//     files and to compute total <length> in samples on song save.
//
// Future commands (Phase 6+):
//   - list_usb_drives: enumerate mounted external volumes
//   - copy_to_usb: stream a working folder to a USB drive with progress
//   - dot_clean: shell out to `dot_clean -m <path>` on macOS

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WavInfo {
    /// Number of audio channels: 1 = mono, 2 = stereo, etc.
    /// BandMate requires mono — use this to flag stereo files in the UI.
    pub channels: u16,
    /// Sample rate in Hz (typically 44100 or 48000).
    pub sample_rate: u32,
    /// Bit depth: 16, 24, or 32 typically.
    pub bit_depth: u16,
    /// Total length in samples (frames per channel).
    pub duration_samples: u64,
    /// Total length in seconds (duration_samples / sample_rate).
    pub duration_seconds: f64,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! BandMate Studio's Rust backend is alive.", name)
}

/// Probe a WAV file's header.
///
/// Reads only the header (no audio data is loaded into memory), so this
/// is fast even for very large files. Returns an error string if the
/// file doesn't exist, isn't a WAV, or has an unreadable header.
///
/// The returned struct uses camelCase field names so it deserializes
/// directly into the TypeScript `WavInfo` type defined in src/codec/types.ts.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![greet, probe_wav])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
