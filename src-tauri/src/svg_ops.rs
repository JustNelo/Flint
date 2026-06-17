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
