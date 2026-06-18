use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProgressPayload {
    pub completed: usize,
    pub total: usize,
    pub current_file: String,
}

/// Emit a `"processing-progress"` event after atomically incrementing the
/// processed counter.  Works for both parallel (`AtomicUsize`) and sequential
/// loops — callers just pass the shared counter.
pub fn emit_progress(
    app_handle: &tauri::AppHandle,
    processed: &AtomicUsize,
    total: usize,
    current_file: &str,
) {
    let done = processed.fetch_add(1, Ordering::Relaxed) + 1;
    emit_progress_simple(app_handle, done, total, current_file);
}

/// Convenience wrapper for sequential loops where no `AtomicUsize` is needed.
/// Simply emits progress with the given completed/total values.
pub fn emit_progress_simple(
    app_handle: &tauri::AppHandle,
    completed: usize,
    total: usize,
    current_file: &str,
) {
    let filename = std::path::Path::new(current_file)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(current_file)
        .to_string();
    let _ = app_handle.emit(
        "processing-progress",
        ProgressPayload {
            completed,
            total,
            current_file: filename,
        },
    );
}
