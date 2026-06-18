use gif::{Encoder, Frame, Repeat};
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::PathBuf;

use crate::progress::emit_progress_simple;
use crate::utils::ensure_output_dir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnimationResult {
    pub output_path: String,
    pub frame_count: usize,
    pub format: String,
    pub errors: Vec<String>,
}

/// Create an animated GIF from a sequence of image paths.
/// All frames are resized to match the first frame's dimensions.
pub fn create_gif(
    image_paths: &[String],
    delay_ms: u16,
    loop_count: u16,
    output_dir: &str,
    app_handle: &tauri::AppHandle,
) -> AnimationResult {
    let mut result = AnimationResult {
        output_path: String::new(),
        frame_count: 0,
        format: "gif".to_string(),
        errors: Vec::new(),
    };

    if image_paths.is_empty() {
        result.errors.push("No images provided".to_string());
        return result;
    }

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    // Load first image to determine dimensions
    let first_img = match image::open(&image_paths[0]) {
        Ok(img) => img,
        Err(e) => {
            result
                .errors
                .push(format!("Cannot open first image: {}", e));
            return result;
        }
    };

    let (width, height) = first_img.dimensions();

    if width > u16::MAX as u32 || height > u16::MAX as u32 {
        result.errors.push(format!(
            "Image dimensions {}x{} exceed GIF maximum of {}x{}",
            width,
            height,
            u16::MAX,
            u16::MAX
        ));
        return result;
    }
    let gif_width = width as u16;
    let gif_height = height as u16;

    let output_path = out_dir.join("animation.gif");
    let file = match File::create(&output_path) {
        Ok(f) => f,
        Err(e) => {
            result
                .errors
                .push(format!("Cannot create output file: {}", e));
            return result;
        }
    };

    let mut encoder = match Encoder::new(file, gif_width, gif_height, &[]) {
        Ok(enc) => enc,
        Err(e) => {
            result
                .errors
                .push(format!("Cannot create GIF encoder: {}", e));
            return result;
        }
    };

    // Set repeat behavior
    let repeat = if loop_count == 0 {
        Repeat::Infinite
    } else {
        Repeat::Finite(loop_count)
    };
    if let Err(e) = encoder.set_repeat(repeat) {
        result.errors.push(format!("Cannot set loop: {}", e));
        return result;
    }

    // GIF delay is in centiseconds (1/100th of a second)
    let delay_cs = (delay_ms / 10).max(1);

    for (i, path) in image_paths.iter().enumerate() {
        let img = match image::open(path) {
            Ok(img) => img,
            Err(e) => {
                result.errors.push(format!("Frame {}: {}", i + 1, e));
                continue;
            }
        };

        // Resize to match first frame dimensions
        let resized = img.resize_exact(
            gif_width as u32,
            gif_height as u32,
            image::imageops::FilterType::Triangle,
        );

        let rgba = resized.to_rgba8();
        let mut pixels = rgba.into_raw();

        let mut frame = Frame::from_rgba_speed(gif_width, gif_height, &mut pixels, 30);
        frame.delay = delay_cs;

        if let Err(e) = encoder.write_frame(&frame) {
            result
                .errors
                .push(format!("Frame {}: write error — {}", i + 1, e));
            continue;
        }

        result.frame_count += 1;
        emit_progress_simple(app_handle, i + 1, image_paths.len(), path);
    }

    result.output_path = output_path.to_string_lossy().to_string();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    // `create_gif` requires a live `&tauri::AppHandle` (it calls
    // `emit_progress_simple`, which invokes `app_handle.emit(...)`), so the GIF
    // encoding path itself cannot be exercised in a unit test. The remaining
    // deterministic, load-bearing surface is the `AnimationResult` serde
    // contract: the React frontend reads `output_path`, `frame_count`,
    // `format`, and `errors` by these exact snake_case names, so a rename would
    // silently break the UI.

    #[test]
    fn animation_result_serializes_with_frontend_field_names() {
        let result = AnimationResult {
            output_path: "/tmp/out/animation.gif".to_string(),
            frame_count: 3,
            format: "gif".to_string(),
            errors: vec!["frame 2 failed".to_string()],
        };

        let json = serde_json::to_string(&result).expect("serialize AnimationResult");
        let value: Value = serde_json::from_str(&json).expect("parse serialized JSON");

        // Exact field names the frontend (AnimationTab.tsx) depends on.
        assert_eq!(value["output_path"], "/tmp/out/animation.gif");
        assert_eq!(value["frame_count"], 3);
        assert_eq!(value["format"], "gif");
        assert_eq!(value["errors"][0], "frame 2 failed");

        // No camelCase aliases should leak in.
        assert!(value.get("frameCount").is_none());
        assert!(value.get("outputPath").is_none());

        let obj = value.as_object().expect("JSON object");
        assert_eq!(obj.len(), 4, "exactly four serialized fields");
    }

    #[test]
    fn animation_result_round_trips_through_json() {
        let original = AnimationResult {
            output_path: "C:\\out\\animation.gif".to_string(),
            frame_count: 0,
            format: "gif".to_string(),
            errors: vec!["No images provided".to_string(), "second error".to_string()],
        };

        let json = serde_json::to_string(&original).expect("serialize");
        let decoded: AnimationResult = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(decoded.output_path, original.output_path);
        assert_eq!(decoded.frame_count, original.frame_count);
        assert_eq!(decoded.format, original.format);
        assert_eq!(decoded.errors, original.errors);
    }

    #[test]
    fn animation_result_empty_errors_serializes_as_empty_array() {
        let result = AnimationResult {
            output_path: String::new(),
            frame_count: 0,
            format: "gif".to_string(),
            errors: Vec::new(),
        };

        let value: Value =
            serde_json::from_str(&serde_json::to_string(&result).expect("serialize"))
                .expect("parse");

        // The frontend checks `res.errors.length === 0`, so errors must be a
        // JSON array (never null/omitted) even when empty.
        assert!(value["errors"].is_array());
        assert_eq!(value["errors"].as_array().expect("array").len(), 0);
        assert_eq!(value["output_path"], "");
    }
}
