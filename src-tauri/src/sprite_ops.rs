use image::{DynamicImage, GenericImageView, RgbaImage};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::progress::emit_progress_simple;
use crate::utils::ensure_output_dir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpriteSheetResult {
    pub image_path: String,
    pub atlas_path: String,
    pub sprite_count: usize,
    pub sheet_width: u32,
    pub sheet_height: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
struct AtlasFrame {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Serialize)]
struct AtlasJson {
    frames: HashMap<String, AtlasFrame>,
}

/// Generate a sprite sheet from multiple images arranged in a grid.
/// All images are resized to match the largest width/height found.
/// Outputs the spritesheet PNG and a JSON atlas file.
pub fn generate_spritesheet(
    image_paths: &[String],
    columns: u32,
    padding: u32,
    output_dir: &str,
    app_handle: &tauri::AppHandle,
) -> SpriteSheetResult {
    let mut result = SpriteSheetResult {
        image_path: String::new(),
        atlas_path: String::new(),
        sprite_count: 0,
        sheet_width: 0,
        sheet_height: 0,
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

    let cols = columns.max(1);

    // Load all images in parallel
    let loaded: Vec<(String, Result<DynamicImage, String>)> = image_paths
        .par_iter()
        .map(|path| {
            let name = std::path::Path::new(path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("sprite")
                .to_string();
            let img_result =
                image::open(path).map_err(|e| format!("Cannot open '{}': {}", path, e));
            (name, img_result)
        })
        .collect();

    let mut images: Vec<(String, DynamicImage)> = Vec::new();
    for (name, img_result) in loaded {
        match img_result {
            Ok(img) => images.push((name, img)),
            Err(e) => result.errors.push(e),
        }
    }

    if images.is_empty() {
        result.errors.push("No valid images loaded".to_string());
        return result;
    }

    // Find max cell dimensions
    let max_w = images
        .iter()
        .map(|(_, img)| img.width())
        .max()
        .unwrap_or(64);
    let max_h = images
        .iter()
        .map(|(_, img)| img.height())
        .max()
        .unwrap_or(64);

    let count = images.len() as u32;
    let rows = count.div_ceil(cols);

    let sheet_width = cols * max_w + (cols + 1) * padding;
    let sheet_height = rows * max_h + (rows + 1) * padding;

    let mut sheet = RgbaImage::new(sheet_width, sheet_height);

    // Fill with transparent
    for pixel in sheet.pixels_mut() {
        *pixel = image::Rgba([0, 0, 0, 0]);
    }

    let mut atlas_frames: Vec<(String, AtlasFrame)> = Vec::new();

    let total_sprites = images.len();
    for (i, (name, img)) in images.iter().enumerate() {
        let col = (i as u32) % cols;
        let row = (i as u32) / cols;

        let x = padding + col * (max_w + padding);
        let y = padding + row * (max_h + padding);

        // Center the image within the cell if smaller than max
        let (iw, ih) = img.dimensions();
        let offset_x = (max_w.saturating_sub(iw)) / 2;
        let offset_y = (max_h.saturating_sub(ih)) / 2;

        let rgba = img.to_rgba8();
        image::imageops::overlay(
            &mut sheet,
            &rgba,
            (x + offset_x) as i64,
            (y + offset_y) as i64,
        );

        atlas_frames.push((
            name.clone(),
            AtlasFrame {
                x,
                y,
                w: iw.min(max_w),
                h: ih.min(max_h),
            },
        ));

        result.sprite_count += 1;
        emit_progress_simple(app_handle, i + 1, total_sprites, name);
    }

    // Save spritesheet PNG
    let image_path = out_dir.join("spritesheet.png");
    match sheet.save(&image_path) {
        Ok(_) => {
            result.image_path = image_path.to_string_lossy().to_string();
            result.sheet_width = sheet_width;
            result.sheet_height = sheet_height;
        }
        Err(e) => {
            result
                .errors
                .push(format!("Cannot save spritesheet: {}", e));
            return result;
        }
    }

    // Build and save JSON atlas
    let atlas_json = build_atlas_json(atlas_frames);
    let atlas_path = out_dir.join("spritesheet.json");
    match std::fs::write(&atlas_path, atlas_json) {
        Ok(_) => {
            result.atlas_path = atlas_path.to_string_lossy().to_string();
        }
        Err(e) => {
            result.errors.push(format!("Cannot save atlas JSON: {}", e));
        }
    }

    result
}

fn build_atlas_json(frames: Vec<(String, AtlasFrame)>) -> String {
    let atlas = AtlasJson {
        frames: frames.into_iter().collect(),
    };
    serde_json::to_string_pretty(&atlas).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn atlas_json_empty_has_empty_frames_object() {
        let json = build_atlas_json(Vec::new());
        let parsed: Value = serde_json::from_str(&json).expect("valid JSON");
        let frames = parsed.get("frames").expect("frames key present");
        assert!(frames.is_object(), "frames should be a JSON object");
        assert_eq!(
            frames.as_object().unwrap().len(),
            0,
            "no frames means empty object"
        );
    }

    #[test]
    fn atlas_json_preserves_frame_geometry() {
        let frames = vec![
            (
                "alpha".to_string(),
                AtlasFrame {
                    x: 1,
                    y: 2,
                    w: 32,
                    h: 48,
                },
            ),
            (
                "beta".to_string(),
                AtlasFrame {
                    x: 100,
                    y: 200,
                    w: 16,
                    h: 16,
                },
            ),
        ];

        let json = build_atlas_json(frames);
        let parsed: Value = serde_json::from_str(&json).expect("valid JSON");
        let frames = parsed.get("frames").expect("frames key present");

        let alpha = frames.get("alpha").expect("alpha frame present");
        assert_eq!(alpha.get("x").and_then(Value::as_u64), Some(1));
        assert_eq!(alpha.get("y").and_then(Value::as_u64), Some(2));
        assert_eq!(alpha.get("w").and_then(Value::as_u64), Some(32));
        assert_eq!(alpha.get("h").and_then(Value::as_u64), Some(48));

        let beta = frames.get("beta").expect("beta frame present");
        assert_eq!(beta.get("x").and_then(Value::as_u64), Some(100));
        assert_eq!(beta.get("y").and_then(Value::as_u64), Some(200));
        assert_eq!(beta.get("w").and_then(Value::as_u64), Some(16));
        assert_eq!(beta.get("h").and_then(Value::as_u64), Some(16));
    }

    #[test]
    fn atlas_json_deduplicates_repeated_names() {
        // AtlasJson stores frames in a HashMap keyed by name, so a repeated
        // name keeps only one entry (last write wins for HashMap::from_iter).
        let frames = vec![
            (
                "dup".to_string(),
                AtlasFrame {
                    x: 0,
                    y: 0,
                    w: 8,
                    h: 8,
                },
            ),
            (
                "dup".to_string(),
                AtlasFrame {
                    x: 5,
                    y: 5,
                    w: 9,
                    h: 9,
                },
            ),
        ];

        let json = build_atlas_json(frames);
        let parsed: Value = serde_json::from_str(&json).expect("valid JSON");
        let frames_obj = parsed
            .get("frames")
            .and_then(Value::as_object)
            .expect("frames object");

        assert_eq!(
            frames_obj.len(),
            1,
            "repeated key collapses to a single frame"
        );
        assert!(frames_obj.contains_key("dup"));
    }
}
