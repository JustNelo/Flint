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

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use std::path::PathBuf;

    fn temp_png(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("color_ops_{}_{}.png", name, std::process::id()))
    }

    #[test]
    fn solid_color_image_leads_palette_with_that_color() {
        let path = temp_png("solid");
        // Pure red, fully opaque. After quantization 0xFF -> (0xF0) per channel.
        let img = RgbaImage::from_pixel(80, 80, Rgba([255, 0, 0, 255]));
        img.save(&path).expect("save red png");

        let result = extract_palette(path.to_str().unwrap(), 5).expect("extract palette");

        assert_eq!(result.source_path, path.to_str().unwrap());
        assert!(!result.colors.is_empty(), "expected at least one color");

        let lead = &result.colors[0];
        // r,g,b are the quantized values: 255 >> 4 << 4 == 240, 0 stays 0.
        assert_eq!((lead.r, lead.g, lead.b), (240, 0, 0));
        assert_eq!(lead.hex, "#F00000");
        // A solid opaque image: the lead color covers ~100% of pixels.
        assert!(
            lead.percentage > 99.0,
            "lead percentage {} should be ~100",
            lead.percentage
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn fully_transparent_pixels_are_ignored() {
        let path = temp_png("transparent");
        // Alpha 0 -> all pixels skipped (a < 128), so no buckets at all.
        let img = RgbaImage::from_pixel(40, 40, Rgba([10, 20, 30, 0]));
        img.save(&path).expect("save transparent png");

        let result = extract_palette(path.to_str().unwrap(), 5).expect("extract palette");

        assert!(
            result.colors.is_empty(),
            "fully transparent image should yield no colors, got {:?}",
            result.colors
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn distinct_halves_are_both_extracted_and_not_merged() {
        let path = temp_png("halves");
        // Left half red, right half green: far apart in the L1 distance metric
        // (dr+dg+db well over the 60 merge threshold), so both must survive.
        let mut img = RgbaImage::from_pixel(80, 80, Rgba([255, 0, 0, 255]));
        for y in 0..80 {
            for x in 40..80 {
                img.put_pixel(x, y, Rgba([0, 255, 0, 255]));
            }
        }
        img.save(&path).expect("save halves png");

        let result = extract_palette(path.to_str().unwrap(), 5).expect("extract palette");

        let has_red = result.colors.iter().any(|c| (c.r, c.g, c.b) == (240, 0, 0));
        let has_green = result.colors.iter().any(|c| (c.r, c.g, c.b) == (0, 240, 0));
        assert!(has_red, "expected quantized red in {:?}", result.colors);
        assert!(has_green, "expected quantized green in {:?}", result.colors);

        // Every reported percentage is rounded to one decimal place.
        for c in &result.colors {
            let scaled = c.percentage * 10.0;
            assert!(
                (scaled - scaled.round()).abs() < 1e-9,
                "percentage {} not rounded to 1 decimal",
                c.percentage
            );
        }

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn num_colors_caps_returned_palette_length() {
        let path = temp_png("cap");
        // Four well-separated colored quadrants; request only 2.
        let mut img = RgbaImage::from_pixel(80, 80, Rgba([255, 0, 0, 255]));
        for y in 0..80 {
            for x in 0..80 {
                let c = match (x < 40, y < 40) {
                    (true, true) => Rgba([255, 0, 0, 255]),
                    (false, true) => Rgba([0, 255, 0, 255]),
                    (true, false) => Rgba([0, 0, 255, 255]),
                    (false, false) => Rgba([255, 255, 0, 255]),
                };
                img.put_pixel(x, y, c);
            }
        }
        img.save(&path).expect("save quadrants png");

        let result = extract_palette(path.to_str().unwrap(), 2).expect("extract palette");
        assert!(
            result.colors.len() <= 2,
            "requested 2 colors, got {}",
            result.colors.len()
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_file_returns_error() {
        let path = temp_png("does_not_exist");
        let _ = std::fs::remove_file(&path); // ensure absent
        let err = extract_palette(path.to_str().unwrap(), 5)
            .expect_err("opening a missing file must fail");
        assert!(err.contains("Cannot open"), "unexpected error: {}", err);
    }
}
