use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;

use crate::utils::ensure_output_dir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QrResult {
    pub output_path: String,
    pub size: u32,
    pub errors: Vec<String>,
}

/// Build the QR code image (white background, dark modules) for `text` at `size` px.
fn build_qr_image(text: &str, size: u32) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
    let size = size.clamp(64, 4096);
    let code = QrCode::new(text.as_bytes()).map_err(|e| format!("QR encoding failed: {}", e))?;

    let module_count = code.width() as u32;
    let module_size = (size / (module_count + 8)).max(1);
    let margin = (size.saturating_sub(module_count * module_size)) / 2;
    let img_size = module_count * module_size + margin * 2;

    let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_pixel(img_size, img_size, Rgba([255, 255, 255, 255]));
    let dark = Rgba([30, 30, 30, 255]);

    for (y, row) in code.to_colors().chunks(module_count as usize).enumerate() {
        for (x, &color) in row.iter().enumerate() {
            if color == qrcode::Color::Dark {
                let px = margin + (x as u32) * module_size;
                let py = margin + (y as u32) * module_size;
                for dy in 0..module_size {
                    for dx in 0..module_size {
                        if px + dx < img_size && py + dy < img_size {
                            img.put_pixel(px + dx, py + dy, dark);
                        }
                    }
                }
            }
        }
    }

    Ok(img)
}

/// Generate a QR code PNG from the given text content.
/// The output image is `size × size` pixels with a white background and dark modules.
pub fn generate_qr(text: &str, size: u32, output_dir: &str) -> QrResult {
    let mut result = QrResult {
        output_path: String::new(),
        size,
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    let img = match build_qr_image(text, size) {
        Ok(img) => img,
        Err(e) => {
            result.errors.push(e);
            return result;
        }
    };

    let output_path = out_dir.join("qrcode.png");
    match img.save(&output_path) {
        Ok(_) => {
            result.output_path = output_path.to_string_lossy().to_string();
        }
        Err(e) => {
            result.errors.push(format!("Cannot save QR image: {}", e));
        }
    }

    result
}

/// Generate a QR code PNG and return it as a base64 string (no file written) — for live preview.
pub fn generate_qr_base64(text: &str, size: u32) -> Result<String, String> {
    use base64::Engine;
    let img = build_qr_image(text, size)?;
    let mut buf: Vec<u8> = Vec::new();
    DynamicImage::ImageRgba8(img)
        .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| format!("PNG encode failed: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_qr_base64_produces_png() {
        use base64::Engine;
        let b64 = generate_qr_base64("https://flint.app", 256).expect("should encode");
        assert!(!b64.is_empty());
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&b64)
            .expect("valid base64");
        assert_eq!(
            &bytes[0..8],
            &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        );
    }
}
