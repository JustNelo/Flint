use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use crate::utils::{ensure_output_dir, file_stem};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SvgRasterizeResult {
    pub output_path: String,
    pub width: u32,
    pub height: u32,
}

pub fn rasterize_svg(
    input_path: &str,
    target_width: u32,
    output_format: &str,
    output_dir: &str,
) -> Result<SvgRasterizeResult, String> {
    ensure_output_dir(Path::new(output_dir))?;

    let svg_data = fs::read(input_path).map_err(|e| format!("Cannot read SVG file: {}", e))?;

    let tree = resvg::usvg::Tree::from_data(&svg_data, &resvg::usvg::Options::default())
        .map_err(|e| format!("Cannot parse SVG: {}", e))?;

    let original_size = tree.size();
    let scale = target_width as f32 / original_size.width();
    let target_height = (original_size.height() * scale) as u32;

    let mut pixmap = resvg::tiny_skia::Pixmap::new(target_width, target_height)
        .ok_or_else(|| "Cannot create pixel buffer".to_string())?;

    let transform = resvg::tiny_skia::Transform::from_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());

    let stem = file_stem(input_path);
    let format_lower = output_format.to_lowercase();

    let ext = match format_lower.as_str() {
        "webp" => "webp",
        _ => "png",
    };

    let output_path = Path::new(output_dir).join(format!("{}-{}px.{}", stem, target_width, ext));

    if ext == "png" {
        // tiny-skia's encode_png correctly un-premultiplies alpha.
        let png = pixmap
            .encode_png()
            .map_err(|e| format!("Cannot encode PNG: {}", e))?;
        fs::write(&output_path, &png).map_err(|e| format!("Cannot write PNG file: {}", e))?;
    } else {
        // WebP: convert premultiplied pixels to straight alpha before encoding.
        let mut straight = pixmap.data().to_vec();
        for px in straight.chunks_exact_mut(4) {
            let a = px[3] as u32;
            if a > 0 && a < 255 {
                px[0] = ((px[0] as u32 * 255 + a / 2) / a).min(255) as u8;
                px[1] = ((px[1] as u32 * 255 + a / 2) / a).min(255) as u8;
                px[2] = ((px[2] as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
        let encoder = webp::Encoder::from_rgba(&straight, target_width, target_height);
        let webp_data = encoder.encode(90.0);
        fs::write(&output_path, &*webp_data)
            .map_err(|e| format!("Cannot write WebP file: {}", e))?;
    }

    Ok(SvgRasterizeResult {
        output_path: output_path.to_string_lossy().to_string(),
        width: target_width,
        height: target_height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Build a unique temp directory path for a given test, isolating parallel runs.
    fn unique_dir(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "svg_ops-{}-{}-{}",
            test,
            std::process::id(),
            // Nanosecond clock disambiguates repeated runs within the same process.
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    /// Write an inline SVG string to `<dir>/<stem>.svg` and return the path.
    fn write_svg(dir: &Path, stem: &str, svg: &str) -> PathBuf {
        let path = dir.join(format!("{}.svg", stem));
        std::fs::write(&path, svg).expect("write svg");
        path
    }

    #[test]
    fn rasterizes_square_svg_to_png_with_requested_dimensions() {
        let dir = unique_dir("square_png");
        // 100x100 user-space viewBox filled solid red, fully opaque.
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="rgb(255,0,0)"/></svg>"#;
        let input = write_svg(&dir, "square", svg);

        let result = rasterize_svg(input.to_str().unwrap(), 64, "png", dir.to_str().unwrap())
            .expect("rasterize png");

        // Square source scaled to width 64 -> height 64.
        assert_eq!(result.width, 64);
        assert_eq!(result.height, 64);
        assert!(result.output_path.ends_with("square-64px.png"));

        // The written PNG must actually have those dimensions on disk.
        let decoded = image::open(&result.output_path).expect("open png");
        assert_eq!(decoded.width(), 64);
        assert_eq!(decoded.height(), 64);

        // A center pixel should be opaque red after un-premultiplication.
        let rgba = decoded.to_rgba8();
        let px = rgba.get_pixel(32, 32);
        assert_eq!(px[3], 255, "center pixel must be fully opaque");
        assert_eq!(px[0], 255, "red channel");
        assert_eq!(px[1], 0, "green channel");
        assert_eq!(px[2], 0, "blue channel");

        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&result.output_path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_aspect_ratio_when_scaling_width() {
        let dir = unique_dir("aspect");
        // 200 wide x 50 tall (4:1). Scaling to width 40 must yield height 10.
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50" width="200" height="50"><rect x="0" y="0" width="200" height="50" fill="rgb(0,128,255)"/></svg>"#;
        let input = write_svg(&dir, "wide", svg);

        let result = rasterize_svg(input.to_str().unwrap(), 40, "png", dir.to_str().unwrap())
            .expect("rasterize png");

        assert_eq!(result.width, 40);
        assert_eq!(result.height, 10);

        let decoded = image::open(&result.output_path).expect("open png");
        assert_eq!(decoded.width(), 40);
        assert_eq!(decoded.height(), 10);

        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&result.output_path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn webp_branch_writes_webp_extension_and_decodes() {
        let dir = unique_dir("webp");
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><rect x="0" y="0" width="80" height="80" fill="rgb(0,255,0)"/></svg>"#;
        let input = write_svg(&dir, "leaf", svg);

        let result = rasterize_svg(
            input.to_str().unwrap(),
            32,
            "WEBP", // exercise case-insensitive format matching
            dir.to_str().unwrap(),
        )
        .expect("rasterize webp");

        assert_eq!(result.width, 32);
        assert_eq!(result.height, 32);
        assert!(
            result.output_path.ends_with("leaf-32px.webp"),
            "expected webp extension, got {}",
            result.output_path
        );

        // The encoded WebP must be readable back and keep its dimensions.
        let decoded = image::open(&result.output_path).expect("open webp");
        assert_eq!(decoded.width(), 32);
        assert_eq!(decoded.height(), 32);

        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&result.output_path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_format_defaults_to_png() {
        let dir = unique_dir("default_fmt");
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect x="0" y="0" width="10" height="10" fill="rgb(10,20,30)"/></svg>"#;
        let input = write_svg(&dir, "tiny", svg);

        let result = rasterize_svg(
            input.to_str().unwrap(),
            10,
            "tiff", // unrecognized -> falls through to png
            dir.to_str().unwrap(),
        )
        .expect("rasterize default");

        assert!(
            result.output_path.ends_with("tiny-10px.png"),
            "unknown format must default to png, got {}",
            result.output_path
        );
        assert!(Path::new(&result.output_path).exists());

        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&result.output_path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_input_file_errors() {
        let dir = unique_dir("missing");
        let missing = dir.join("does-not-exist.svg");

        let err = rasterize_svg(missing.to_str().unwrap(), 32, "png", dir.to_str().unwrap())
            .expect_err("should fail to read missing file");
        assert!(err.contains("Cannot read SVG file"), "got: {}", err);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
