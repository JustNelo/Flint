use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ColorInfo {
    pub hex: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub percentage: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaletteResult {
    pub colors: Vec<ColorInfo>,
    pub source_path: String,
}

/// Extract dominant colors using histogram-based quantization.
/// Downscales the image, buckets pixel colors, then picks the top N.
pub fn extract_palette(image_path: &str, num_colors: usize) -> Result<PaletteResult, String> {
    let img =
        image::open(image_path).map_err(|e| format!("Cannot open '{}': {}", image_path, e))?;

    // Downscale for speed — 100x100 is enough for color extraction
    let thumb = img.resize(100, 100, image::imageops::FilterType::Triangle);
    let rgba = thumb.to_rgba8();
    let total_pixels = (rgba.width() * rgba.height()) as f64;

    // Quantize each pixel to 4-bit per channel (16 levels) to reduce noise
    let mut buckets: HashMap<(u8, u8, u8), u32> = HashMap::new();

    for pixel in rgba.pixels() {
        let [r, g, b, a] = pixel.0;
        // Skip fully transparent pixels
        if a < 128 {
            continue;
        }
        // Quantize to 16 levels per channel
        let qr = (r >> 4) << 4;
        let qg = (g >> 4) << 4;
        let qb = (b >> 4) << 4;
        *buckets.entry((qr, qg, qb)).or_insert(0) += 1;
    }

    // Sort buckets by frequency (descending)
    let mut sorted: Vec<((u8, u8, u8), u32)> = buckets.into_iter().collect();
    sorted.sort_by_key(|b| std::cmp::Reverse(b.1));

    // Merge similar colors that are too close together
    let mut final_colors: Vec<((u8, u8, u8), u32)> = Vec::new();

    for (color, count) in &sorted {
        let too_close = final_colors.iter().any(|(existing, _)| {
            let dr = (color.0 as i32 - existing.0 as i32).abs();
            let dg = (color.1 as i32 - existing.1 as i32).abs();
            let db = (color.2 as i32 - existing.2 as i32).abs();
            dr + dg + db < 60
        });

        if !too_close {
            final_colors.push((*color, *count));
        }

        if final_colors.len() >= num_colors {
            break;
        }
    }

    let colors: Vec<ColorInfo> = final_colors
        .iter()
        .map(|((r, g, b), count)| {
            let percentage = (*count as f64 / total_pixels) * 100.0;
            ColorInfo {
                hex: format!("#{:02X}{:02X}{:02X}", r, g, b),
                r: *r,
                g: *g,
                b: *b,
                percentage: (percentage * 10.0).round() / 10.0,
            }
        })
        .collect();

    Ok(PaletteResult {
        colors,
        source_path: image_path.to_string(),
    })
}
