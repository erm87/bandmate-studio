// MIDI file cleaning (Phase 7).
//
// "Clean" means the file contains ONLY events that should reach a
// downstream device on a live MIDI port. The rule list is documented
// in Bandmate/MANUAL_ADDITIONS.md ("MIDI authoring guidance for
// Kemper-bound MIDI tracks") — TL;DR:
//
//   Keep:  program_change, control_change, note_on, note_off,
//          pitch_bend, channel_pressure, polyphonic_pressure,
//          set_tempo (BandMate filters it from wire; harmless),
//          end_of_track (required by SMF spec).
//
//   Strip: marker, time_signature, key_signature, track_name,
//          instrument_name, smpte_offset, channel_prefix, text,
//          copyright, lyrics, cue_point, midi_port, midi_channel,
//          and any other meta event not in the keep-list.
//
//   SysEx is preserved — rare, almost always intentional when present.
//
// Two operations:
//
//   * `is_clean(&path)` — parse the file and return true if it
//     contains no strip-list events. Used to compute the "Clean"
//     badge in the UI without persisting any state. Idempotent.
//
//   * `clean(&path)` — rewrite the file in place, removing strip-list
//     events. Atomic via temp-and-rename: write to <name>.cleaning.tmp,
//     re-parse it for sanity, then `fs::rename` over the original.
//     Returns the count of removed events so the caller can decide
//     whether to surface a notification.

use midly::{MetaMessage, Smf, TrackEvent, TrackEventKind};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Outcome of a clean operation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    /// True if the file was rewritten (had stripped events).
    /// False is a no-op success: file was already clean.
    pub was_modified: bool,
    /// Number of events removed across all tracks.
    pub events_removed: u32,
}

/// Returns true if the meta event should be kept on a live MIDI wire.
fn keep_meta(m: &MetaMessage<'_>) -> bool {
    matches!(
        m,
        MetaMessage::Tempo(_)        // set_tempo: kept (BandMate filters from wire, but useful for DAW re-import)
        | MetaMessage::EndOfTrack    // required by SMF spec
    )
}

/// Returns true if the event kind survives the clean pass.
fn keep_event(kind: &TrackEventKind<'_>) -> bool {
    match kind {
        // All channel-voice messages: program_change, control_change,
        // note_on/off, pitch_bend, channel/poly aftertouch.
        TrackEventKind::Midi { .. } => true,
        // SysEx: rare, intentional when present. Preserved.
        TrackEventKind::SysEx(_) | TrackEventKind::Escape(_) => true,
        // Meta events: filtered by keep_meta.
        TrackEventKind::Meta(m) => keep_meta(m),
    }
}

/// Read the file and return whether every event passes `keep_event`.
/// Errors during parsing surface as `Err` — callers can decide whether
/// "unparseable" should be treated as not-clean (typical) or surfaced.
pub fn is_clean(path: &Path) -> Result<bool, String> {
    let bytes = fs::read(path).map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    let smf = Smf::parse(&bytes).map_err(|e| format!("Not a valid MIDI file: {}", e))?;
    for track in &smf.tracks {
        for ev in track {
            if !keep_event(&ev.kind) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// Remove strip-list events from `path` in place. Atomic: the cleaned
/// bytes are written to `<path>.cleaning.tmp`, re-parsed for sanity,
/// then renamed over the original. If anything fails the original is
/// untouched.
pub fn clean(path: &Path) -> Result<CleanResult, String> {
    let bytes = fs::read(path).map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    let smf = Smf::parse(&bytes).map_err(|e| format!("Not a valid MIDI file: {}", e))?;

    // Walk every track, retaining keepers. Re-time stripped events into
    // the next surviving event by accumulating their delta_t — without
    // this, removing a 1920-tick `marker` at the head of a track would
    // shift every subsequent event 1920 ticks earlier on the timeline.
    //
    // Algorithm: keep a `pending_delta` accumulator. For each event:
    //   - if keep: emit with delta = event.delta + pending_delta, reset accumulator
    //   - if strip: pending_delta += event.delta (drop the event)
    let mut new_tracks: Vec<Vec<TrackEvent>> = Vec::with_capacity(smf.tracks.len());
    let mut events_removed: u32 = 0;

    for track in &smf.tracks {
        let mut out: Vec<TrackEvent> = Vec::with_capacity(track.len());
        let mut pending_delta: u32 = 0;
        for ev in track {
            if keep_event(&ev.kind) {
                let combined = pending_delta.saturating_add(ev.delta.as_int());
                out.push(TrackEvent {
                    delta: combined.into(),
                    kind: ev.kind.clone(),
                });
                pending_delta = 0;
            } else {
                pending_delta = pending_delta.saturating_add(ev.delta.as_int());
                events_removed += 1;
            }
        }
        new_tracks.push(out);
    }

    if events_removed == 0 {
        return Ok(CleanResult {
            was_modified: false,
            events_removed: 0,
        });
    }

    let cleaned = Smf {
        header: smf.header,
        tracks: new_tracks,
    };

    // Serialize to a buffer first so we can validate before touching disk.
    let mut buf: Vec<u8> = Vec::with_capacity(bytes.len());
    cleaned
        .write(&mut buf)
        .map_err(|e| format!("Failed to serialize cleaned MIDI: {}", e))?;

    // Sanity check: cleaned bytes must round-trip parse.
    Smf::parse(&buf).map_err(|e| {
        format!(
            "Refusing to overwrite {}: cleaned bytes failed re-parse: {}",
            path.display(),
            e,
        )
    })?;

    // Atomic write: temp file in the same directory (so rename is on
    // the same filesystem), then rename. Same-directory ensures the
    // rename is a single inode-level operation rather than a copy.
    let tmp_path = path.with_extension(make_tmp_extension(path));
    fs::write(&tmp_path, &buf)
        .map_err(|e| format!("Failed to write tmp file {}: {}", tmp_path.display(), e))?;
    if let Err(e) = fs::rename(&tmp_path, path) {
        // Best-effort cleanup of the tmp on rename failure.
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "Failed to rename {} over {}: {}",
            tmp_path.display(),
            path.display(),
            e,
        ));
    }

    Ok(CleanResult {
        was_modified: true,
        events_removed,
    })
}

/// Build a `.cleaning.tmp` extension that preserves the original
/// extension as a prefix. e.g. `foo.mid` → `mid.cleaning.tmp`. This
/// keeps any extension-based filtering on the working folder happy
/// while the rename is in flight (very brief, but defensible).
fn make_tmp_extension(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mid");
    format!("{}.cleaning.tmp", ext)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use midly::{Format, Header, Timing, TrackEvent, TrackEventKind};
    use std::io::Write;

    /// Build a minimal SMF with one track containing the given events,
    /// then write it to a tempfile-style path and return the path.
    fn write_test_smf(path: &Path, events: Vec<TrackEvent<'static>>) {
        let smf = Smf {
            header: Header::new(Format::SingleTrack, Timing::Metrical(480.into())),
            tracks: vec![events],
        };
        let mut buf = Vec::new();
        smf.write(&mut buf).unwrap();
        let mut f = fs::File::create(path).unwrap();
        f.write_all(&buf).unwrap();
    }

    fn tempdir() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "bandmate-midi-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn is_clean_detects_dirty_marker() {
        let dir = tempdir();
        let p = dir.join("dirty.mid");
        write_test_smf(
            &p,
            vec![
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Meta(MetaMessage::Marker(b"Verse".as_ref())),
                },
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
                },
            ],
        );
        assert_eq!(is_clean(&p).unwrap(), false);
    }

    #[test]
    fn is_clean_accepts_pc_only() {
        let dir = tempdir();
        let p = dir.join("clean.mid");
        write_test_smf(
            &p,
            vec![
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Midi {
                        channel: 0.into(),
                        message: midly::MidiMessage::ProgramChange { program: 5.into() },
                    },
                },
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
                },
            ],
        );
        assert_eq!(is_clean(&p).unwrap(), true);
    }

    #[test]
    fn clean_strips_marker_and_keeps_pc() {
        let dir = tempdir();
        let p = dir.join("dirty.mid");
        write_test_smf(
            &p,
            vec![
                TrackEvent {
                    delta: 100.into(),
                    kind: TrackEventKind::Meta(MetaMessage::Marker(b"Verse".as_ref())),
                },
                TrackEvent {
                    delta: 50.into(),
                    kind: TrackEventKind::Midi {
                        channel: 0.into(),
                        message: midly::MidiMessage::ProgramChange { program: 5.into() },
                    },
                },
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
                },
            ],
        );
        let res = clean(&p).unwrap();
        assert!(res.was_modified);
        assert_eq!(res.events_removed, 1);
        assert!(is_clean(&p).unwrap());

        // Re-time check: the PC's delta should be 100 + 50 = 150 after
        // the marker (delta 100) is absorbed into it.
        let bytes = fs::read(&p).unwrap();
        let smf = Smf::parse(&bytes).unwrap();
        let pc = smf.tracks[0]
            .iter()
            .find(|ev| matches!(ev.kind, TrackEventKind::Midi { .. }))
            .unwrap();
        assert_eq!(pc.delta.as_int(), 150);
    }

    #[test]
    fn clean_is_idempotent() {
        let dir = tempdir();
        let p = dir.join("clean.mid");
        write_test_smf(
            &p,
            vec![
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Midi {
                        channel: 0.into(),
                        message: midly::MidiMessage::ProgramChange { program: 5.into() },
                    },
                },
                TrackEvent {
                    delta: 0.into(),
                    kind: TrackEventKind::Meta(MetaMessage::EndOfTrack),
                },
            ],
        );
        let res = clean(&p).unwrap();
        assert!(!res.was_modified);
        assert_eq!(res.events_removed, 0);
    }
}
