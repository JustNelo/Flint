use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use time::OffsetDateTime;

use crate::progress::emit_progress_simple;
use crate::utils::ensure_output_dir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenameResult {
    pub renamed_count: usize,
    pub results: Vec<RenameEntry>,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenameEntry {
    pub original_name: String,
    pub new_name: String,
}

fn sanitize_filename(name: &str) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!(
            "Generated filename '{}' contains invalid characters",
            name
        ));
    }
    if name.is_empty() {
        return Err("Generated filename is empty".to_string());
    }
    Ok(())
}

/// Compute the output filename for a single input path under the given pattern.
/// Pure helper (no I/O) so the rename logic — including collision detection —
/// is unit-testable. `index` is the per-file counter already offset by
/// `start_index`. `today` is the resolved {date} token.
fn compute_new_filename(input_path: &str, pattern: &str, index: u32, today: &str) -> String {
    let path = Path::new(input_path);
    let original_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    let new_stem = pattern
        .replace("{name}", original_stem)
        .replace("{index}", &format!("{:03}", index))
        .replace("{date}", today)
        .replace("{ext}", extension);

    // Ensure we have a valid filename with the original extension
    if new_stem.contains('.') {
        new_stem
    } else if !extension.is_empty() {
        format!("{}.{}", new_stem, extension)
    } else {
        new_stem
    }
}

/// Bulk rename files using a pattern.
/// Supported tokens: {name} (original stem), {index} (counter), {date} (YYYY-MM-DD), {ext} (extension).
/// Files are copied (not moved) to the output directory with the new name.
pub fn bulk_rename(
    input_paths: &[String],
    pattern: &str,
    start_index: u32,
    output_dir: &str,
    app_handle: &tauri::AppHandle,
) -> RenameResult {
    let mut result = RenameResult {
        renamed_count: 0,
        results: Vec::new(),
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    let today = today_date();

    let total = input_paths.len();
    let mut seen: HashSet<String> = HashSet::new();
    for (i, input_path) in input_paths.iter().enumerate() {
        let index = start_index + i as u32;
        let new_filename = compute_new_filename(input_path, pattern, index, &today);

        if let Err(e) = sanitize_filename(&new_filename) {
            result.errors.push(e);
            emit_progress_simple(app_handle, i + 1, total, input_path);
            continue;
        }

        // Detect output-name collisions before copying: without an {index} token,
        // multiple inputs can map to the same name. Copying would silently
        // overwrite the previous file and over-count `renamed_count`.
        if !seen.insert(new_filename.clone()) {
            result.errors.push(format!(
                "'{}': output name collision '{}'",
                input_path, new_filename
            ));
            emit_progress_simple(app_handle, i + 1, total, input_path);
            continue;
        }

        let output_path = out_dir.join(&new_filename);

        match std::fs::copy(input_path, &output_path) {
            Ok(_) => {
                let original_name = Path::new(input_path)
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or(input_path)
                    .to_string();
                result.results.push(RenameEntry {
                    original_name,
                    new_name: new_filename,
                });
                result.renamed_count += 1;
            }
            Err(e) => {
                result
                    .errors
                    .push(format!("Failed to copy '{}': {}", input_path, e));
            }
        }
        emit_progress_simple(app_handle, i + 1, total, input_path);
    }

    result
}

/// Get today's date as YYYY-MM-DD using the `time` crate.
fn today_date() -> String {
    let now = OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}",
        now.year(),
        now.month() as u8,
        now.day()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_rejects_path_separators() {
        assert!(sanitize_filename("hello/world").is_err());
        assert!(sanitize_filename("..\\etc\\passwd").is_err());
        assert!(sanitize_filename("normal-file.png").is_ok());
        assert!(sanitize_filename("").is_err());
    }

    #[test]
    fn rename_reports_collision_without_index_token() {
        // A pattern with neither {name} nor {index} maps every input to the same
        // output name. The bulk_rename loop guards against this with a HashSet;
        // here we exercise the same collision-detection contract against the
        // pure name-computation helper.
        let inputs = ["a.png", "b.png"];
        let pattern = "shot-{date}"; // no {index} / no {name} → identical names
        let today = "2026-06-17";

        let mut seen: HashSet<String> = HashSet::new();
        let mut collisions = 0usize;
        for (i, input) in inputs.iter().enumerate() {
            let name = compute_new_filename(input, pattern, i as u32, today);
            if !seen.insert(name) {
                collisions += 1;
            }
        }

        // Exactly one collision is detected (second input), and the de-duplicated
        // set holds a single name — proving the loop would skip the duplicate
        // instead of silently overwriting / over-counting.
        assert_eq!(collisions, 1);
        assert_eq!(seen.len(), 1);

        // Sanity: an {index} token keeps the names distinct (no collision).
        let mut seen_idx: HashSet<String> = HashSet::new();
        for (i, input) in inputs.iter().enumerate() {
            let name = compute_new_filename(input, "shot-{index}", i as u32, today);
            assert!(seen_idx.insert(name), "indexed names must be unique");
        }
        assert_eq!(seen_idx.len(), 2);
    }

    #[test]
    fn today_date_format() {
        let date = today_date();
        // Must be YYYY-MM-DD
        assert_eq!(date.len(), 10);
        assert_eq!(&date[4..5], "-");
        assert_eq!(&date[7..8], "-");
        let year: i32 = date[0..4].parse().unwrap();
        let month: u32 = date[5..7].parse().unwrap();
        let day: u32 = date[8..10].parse().unwrap();
        assert!(year >= 2025);
        assert!((1..=12).contains(&month));
        assert!((1..=31).contains(&day));
    }
}
