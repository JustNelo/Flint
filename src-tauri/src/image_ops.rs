use ab_glyph::{FontArc, PxScale};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageFormat, ImageReader, Rgba};
use imageproc::drawing::draw_text_mut;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};

use crate::progress::emit_progress;
use crate::utils::{ensure_output_dir, file_size, file_stem, get_extension};

/// Pixel margin from image edges for watermark placement.
const WATERMARK_MARGIN_PX: i32 = 20;
/// Pixel spacing between tiles in tiled watermark mode.
const WATERMARK_TILE_SPACING_PX: i32 = 80;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessingResult {
    pub input_path: String,
    pub output_path: String,
    pub success: bool,
    pub error: Option<String>,
    pub input_size: u64,
    pub output_size: u64,
    pub input_width: u32,
    pub input_height: u32,
    pub output_width: u32,
    pub output_height: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BatchProgress {
    pub completed: usize,
    pub total: usize,
    pub results: Vec<ProcessingResult>,
}

impl BatchProgress {
    fn all_failed(input_paths: &[String], error: String) -> Self {
        Self {
            completed: 0,
            total: input_paths.len(),
            results: input_paths
                .iter()
                .map(|p| ProcessingResult {
                    input_path: p.clone(),
                    output_path: String::new(),
                    success: false,
                    error: Some(error.clone()),
                    input_size: 0,
                    output_size: 0,
                    input_width: 0,
                    input_height: 0,
                    output_width: 0,
                    output_height: 0,
                })
                .collect(),
        }
    }
}

fn load_image(path: &str) -> Result<DynamicImage, String> {
    ImageReader::open(path)
        .map_err(|e| format!("Cannot open file '{}': {}", path, e))?
        .decode()
        .map_err(|e| format!("Cannot decode image '{}': {}", path, e))
}

/// Max edge (px) for grid thumbnails. ~2x the ~100px display cell so they stay
/// crisp on hi-dpi screens while the decoded bitmap stays tiny
/// (256*256*4 ≈ 256 KB) regardless of the source image's native resolution.
const THUMBNAIL_MAX_EDGE: u32 = 256;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageThumbnail {
    pub path: String,
    /// Base64-encoded JPEG, or `None` when the file cannot be decoded as a
    /// raster image (e.g. SVG / unsupported) — the frontend then falls back to
    /// the original via the asset protocol.
    pub thumbnail_b64: Option<String>,
}

fn encode_thumbnail(path: &str) -> Result<String, String> {
    use base64::Engine;
    let img = load_image(path)?;
    // `thumbnail` preserves aspect ratio within the box using a fast filter.
    // Drop alpha (JPEG has none) by re-wrapping as RGB8 before encoding.
    let thumb = DynamicImage::ImageRgb8(
        img.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE)
            .to_rgb8(),
    );

    let mut jpeg_buf: Vec<u8> = Vec::new();
    let encoder = JpegEncoder::new_with_quality(Cursor::new(&mut jpeg_buf), 70);
    thumb
        .write_with_encoder(encoder)
        .map_err(|e| format!("JPEG encode failed for '{}': {}", path, e))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&jpeg_buf))
}

/// Generate small base64 JPEG thumbnails for a batch of images, in parallel.
/// Each source path maps to its thumbnail (or `None` on failure) so the grid
/// can decode a bounded-size bitmap instead of the full-resolution original.
pub fn generate_thumbnails(input_paths: &[String]) -> Vec<ImageThumbnail> {
    input_paths
        .par_iter()
        .map(|path| ImageThumbnail {
            path: path.clone(),
            thumbnail_b64: encode_thumbnail(path).ok(),
        })
        .collect()
}

pub fn compress_to_webp(
    input_paths: Vec<String>,
    quality: f32,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let img = load_image(input_path)?;

            let stem = file_stem(input_path);
            let output_path = out_dir.join(format!("{}-compressed.webp", stem));
            write_webp(&img, &output_path, quality)?;

            Ok((output_path.to_string_lossy().to_string(), None))
        },
    )
}

pub fn compress_to_jpeg(
    input_paths: Vec<String>,
    quality: u8,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    let quality = quality.clamp(1, 100);

    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let img = load_image(input_path)?;
            let rgb = img.to_rgb8();

            let stem = file_stem(input_path);
            let output_path = out_dir.join(format!("{}-compressed.jpg", stem));

            let file = fs::File::create(&output_path)
                .map_err(|e| format!("Cannot create JPEG file: {}", e))?;
            let mut writer = std::io::BufWriter::new(file);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, quality);
            rgb.write_with_encoder(encoder)
                .map_err(|e| format!("Cannot encode JPEG: {}", e))?;

            Ok((output_path.to_string_lossy().to_string(), None))
        },
    )
}

/// AVIF encode speed (1 = slowest/smallest … 10 = fastest/largest). 8 keeps the
/// CPU cost manageable; rav1e at lower speeds is brutally heavy on batches.
const AVIF_SPEED: u8 = 8;

pub fn compress_to_avif(
    input_paths: Vec<String>,
    quality: u8,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    let quality = quality.clamp(1, 100);

    let run = || {
        batch_process(
            &input_paths,
            &output_dir,
            &app_handle,
            &cancel,
            |input_path, out_dir| {
                let img = load_image(input_path)?;
                let rgba = img.to_rgba8(); // AVIF supports alpha

                let stem = file_stem(input_path);
                let output_path = out_dir.join(format!("{}-compressed.avif", stem));

                let mut buf: Vec<u8> = Vec::new();
                rgba.write_with_encoder(image::codecs::avif::AvifEncoder::new_with_speed_quality(
                    &mut buf, AVIF_SPEED, quality,
                ))
                .map_err(|e| format!("Cannot encode AVIF: {}", e))?;
                fs::write(&output_path, &buf)
                    .map_err(|e| format!("Cannot write AVIF file: {}", e))?;

                Ok((output_path.to_string_lossy().to_string(), None))
            },
        )
    };

    // rav1e is far heavier than the other encoders, so AVIF runs on its own
    // small pool (~quarter of cores) — it cannot peg the CPU to thermal limits,
    // and a cancel drains quickly since few encodes are ever in flight.
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    match rayon::ThreadPoolBuilder::new()
        .num_threads((cores / 4).max(1))
        .build()
    {
        Ok(pool) => pool.install(run),
        Err(_) => run(),
    }
}

pub fn convert_images(
    input_paths: Vec<String>,
    output_format: String,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    let target_format = output_format.to_lowercase();

    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let img = load_image(input_path)?;
            let stem = file_stem(input_path);

            let output_path_str = match target_format.as_str() {
                "webp" => {
                    let output_path = out_dir.join(format!("{}-converted.webp", stem));
                    write_webp(&img, &output_path, 100.0)?;
                    output_path.to_string_lossy().to_string()
                }
                "avif" => {
                    let output_path = out_dir.join(format!("{}-converted.avif", stem));
                    let rgba = img.to_rgba8();
                    let mut buf: Vec<u8> = Vec::new();
                    rgba.write_with_encoder(
                        image::codecs::avif::AvifEncoder::new_with_speed_quality(
                            &mut buf, AVIF_SPEED, 80,
                        ),
                    )
                    .map_err(|e| format!("Cannot encode AVIF: {}", e))?;
                    fs::write(&output_path, &buf)
                        .map_err(|e| format!("Cannot write AVIF: {}", e))?;
                    output_path.to_string_lossy().to_string()
                }
                "png" => {
                    let output_path = out_dir.join(format!("{}-converted.png", stem));
                    img.save_with_format(&output_path, ImageFormat::Png)
                        .map_err(|e| format!("Cannot save PNG: {}", e))?;
                    output_path.to_string_lossy().to_string()
                }
                "jpg" | "jpeg" => {
                    let output_path = out_dir.join(format!("{}-converted.jpg", stem));
                    img.save_with_format(&output_path, ImageFormat::Jpeg)
                        .map_err(|e| format!("Cannot save JPEG: {}", e))?;
                    output_path.to_string_lossy().to_string()
                }
                "bmp" => {
                    let output_path = out_dir.join(format!("{}-converted.bmp", stem));
                    img.save_with_format(&output_path, ImageFormat::Bmp)
                        .map_err(|e| format!("Cannot save BMP: {}", e))?;
                    output_path.to_string_lossy().to_string()
                }
                "ico" => {
                    let resized = img.resize(256, 256, image::imageops::FilterType::Lanczos3);
                    let output_path = out_dir.join(format!("{}-converted.ico", stem));
                    resized
                        .save_with_format(&output_path, ImageFormat::Ico)
                        .map_err(|e| format!("Cannot save ICO: {}", e))?;
                    output_path.to_string_lossy().to_string()
                }
                "tiff" | "tif" => {
                    let output_path = out_dir.join(format!("{}-converted.tiff", stem));
                    img.save_with_format(&output_path, ImageFormat::Tiff)
                        .map_err(|e| format!("Cannot save TIFF: {}", e))?;
                    output_path.to_string_lossy().to_string()
                }
                _ => return Err(format!("Unsupported output format: {}", target_format)),
            };

            Ok((output_path_str, None))
        },
    )
}

// --- Shared helpers for new features ---

/// Encode `img` as WebP at the given quality (clamped to `[0, 100]`) and write
/// it to `path`. Centralizes the RGBA conversion + encode used by every WebP
/// output site so quality handling stays consistent.
fn write_webp(
    img: &image::DynamicImage,
    path: &std::path::Path,
    quality: f32,
) -> Result<(), String> {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let data = webp::Encoder::from_rgba(&rgba, w, h).encode(quality.clamp(0.0, 100.0));
    std::fs::write(path, &*data).map_err(|e| format!("Cannot write WebP: {}", e))
}

fn save_in_original_format(
    img: &DynamicImage,
    input_path: &str,
    output_path: &Path,
) -> Result<(), String> {
    let ext = get_extension(input_path);
    match ext.as_str() {
        "webp" => write_webp(img, output_path, 90.0),
        "jpg" | "jpeg" => img
            .save_with_format(output_path, ImageFormat::Jpeg)
            .map_err(|e| format!("Cannot save JPEG: {}", e)),
        "bmp" => img
            .save_with_format(output_path, ImageFormat::Bmp)
            .map_err(|e| format!("Cannot save BMP: {}", e)),
        "tiff" | "tif" => img
            .save_with_format(output_path, ImageFormat::Tiff)
            .map_err(|e| format!("Cannot save TIFF: {}", e)),
        "ico" => img
            .save_with_format(output_path, ImageFormat::Ico)
            .map_err(|e| format!("Cannot save ICO: {}", e)),
        _ => img
            .save_with_format(output_path, ImageFormat::Png)
            .map_err(|e| format!("Cannot save PNG: {}", e)),
    }
}

fn build_result(
    input_path: &str,
    result: Result<String, String>,
    dims: Option<(u32, u32, u32, u32)>,
) -> ProcessingResult {
    let input_size = file_size(input_path);
    let (iw, ih, ow, oh) = dims.unwrap_or((0, 0, 0, 0));
    match result {
        Ok(output_path) => {
            let output_size = file_size(&output_path);
            ProcessingResult {
                input_path: input_path.to_string(),
                output_path,
                success: true,
                error: None,
                input_size,
                output_size,
                input_width: iw,
                input_height: ih,
                output_width: ow,
                output_height: oh,
            }
        }
        Err(e) => ProcessingResult {
            input_path: input_path.to_string(),
            output_path: String::new(),
            success: false,
            error: Some(e),
            input_size,
            output_size: 0,
            input_width: iw,
            input_height: ih,
            output_width: 0,
            output_height: 0,
        },
    }
}

// emit_progress is imported from crate::progress

/// Generic batch processor — handles output dir creation, parallel iteration,
/// progress events, and result aggregation. Each caller only provides its
/// per-file processing closure.
///
/// The closure receives `(input_path, output_dir)` and returns
/// `Ok((output_path, optional_dims))` or `Err(message)`.
fn batch_process<F>(
    input_paths: &[String],
    output_dir: &str,
    app_handle: &tauri::AppHandle,
    cancel: &Arc<AtomicBool>,
    process_fn: F,
) -> BatchProgress
where
    F: Fn(&str, &Path) -> Result<(String, Option<(u32, u32, u32, u32)>), String> + Sync,
{
    let total = input_paths.len();
    let out_dir = PathBuf::from(output_dir);

    if let Err(e) = ensure_output_dir(&out_dir) {
        return BatchProgress::all_failed(input_paths, e);
    }

    let processed = AtomicUsize::new(0);

    let results: Vec<ProcessingResult> = input_paths
        .par_iter()
        .map(|input_path| {
            if cancel.load(Ordering::Relaxed) {
                emit_progress(app_handle, &processed, total, input_path);
                return build_result(input_path, Err("Cancelled".to_string()), None);
            }

            let result = process_fn(input_path, &out_dir);
            emit_progress(app_handle, &processed, total, input_path);

            let (path_result, dims) = match result {
                Ok((path, dims)) => (Ok(path), dims),
                Err(e) => (Err(e), None),
            };
            build_result(input_path, path_result, dims)
        })
        .collect();

    let completed = results.iter().filter(|r| r.success).count();
    BatchProgress {
        completed,
        total,
        results,
    }
}

// --- Resize ---

#[allow(clippy::too_many_arguments)]
pub fn resize_images(
    input_paths: Vec<String>,
    mode: String,
    width: u32,
    height: u32,
    percentage: u32,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let img = load_image(input_path)?;
            let (orig_w, orig_h) = (img.width(), img.height());

            let (new_w, new_h) = match mode.as_str() {
                "exact" => (width, height),
                "width" => {
                    let ratio = width as f64 / orig_w as f64;
                    (width, (orig_h as f64 * ratio).round() as u32)
                }
                "height" => {
                    let ratio = height as f64 / orig_h as f64;
                    ((orig_w as f64 * ratio).round() as u32, height)
                }
                "percentage" => {
                    let scale = percentage as f64 / 100.0;
                    (
                        (orig_w as f64 * scale).round() as u32,
                        (orig_h as f64 * scale).round() as u32,
                    )
                }
                _ => return Err(format!("Unknown resize mode: {}", mode)),
            };

            if new_w == 0 || new_h == 0 {
                return Err("Target dimensions cannot be zero".to_string());
            }

            let resized = img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3);

            let ext = get_extension(input_path);
            let stem = file_stem(input_path);
            let output_path = out_dir.join(format!("{}-resized.{}", stem, ext));

            save_in_original_format(&resized, input_path, &output_path)?;
            Ok((
                output_path.to_string_lossy().to_string(),
                Some((orig_w, orig_h, new_w, new_h)),
            ))
        },
    )
}

// --- EXIF Strip ---

pub fn strip_metadata(
    input_paths: Vec<String>,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let img = load_image(input_path)?;
            let (w, h) = (img.width(), img.height());

            let ext = get_extension(input_path);
            let stem = file_stem(input_path);
            let output_path = out_dir.join(format!("{}-stripped.{}", stem, ext));

            save_in_original_format(&img, input_path, &output_path)?;
            Ok((
                output_path.to_string_lossy().to_string(),
                Some((w, h, w, h)),
            ))
        },
    )
}

// --- Watermark ---

/// Cached system font data — read from disk only once across the app lifetime.
static SYSTEM_FONT: LazyLock<Result<Vec<u8>, String>> = LazyLock::new(|| {
    let candidates: Vec<&str> = if cfg!(target_os = "windows") {
        vec![
            "C:\\Windows\\Fonts\\arial.ttf",
            "C:\\Windows\\Fonts\\segoeui.ttf",
            "C:\\Windows\\Fonts\\tahoma.ttf",
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "/Library/Fonts/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFNSText.ttf",
        ]
    } else {
        vec![
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ]
    };

    for path in &candidates {
        if let Ok(data) = fs::read(path) {
            return Ok(data);
        }
    }

    Err("No system font found. Install Arial, DejaVu Sans, or Liberation Sans.".to_string())
});

#[allow(clippy::too_many_arguments)]
pub fn add_watermark(
    input_paths: Vec<String>,
    text: String,
    position: String,
    opacity: f32,
    font_size: f32,
    color: String,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    let font_data = match SYSTEM_FONT.as_ref() {
        Ok(d) => d.clone(),
        Err(e) => return BatchProgress::all_failed(&input_paths, e.clone()),
    };
    let font = match FontArc::try_from_vec(font_data) {
        Ok(f) => f,
        Err(_) => {
            return BatchProgress::all_failed(&input_paths, "Failed to load font".to_string())
        }
    };

    let opacity_byte = (opacity.clamp(0.0, 1.0) * 255.0) as u8;
    let (cr, cg, cb) = crate::utils::parse_hex_color(&color, (255, 255, 255));
    let color = Rgba([cr, cg, cb, opacity_byte]);
    let scale = PxScale::from(font_size);

    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let img = load_image(input_path)?;
            let (img_w, img_h) = (img.width(), img.height());
            let mut base = img.to_rgba8();

            let text_width = (font_size * text.chars().count() as f32 * 0.55) as i32;
            let text_height = font_size as i32;
            let margin = WATERMARK_MARGIN_PX;

            match position.as_str() {
                "center" => {
                    let x = (img_w as i32 - text_width) / 2;
                    let y = (img_h as i32 - text_height) / 2;
                    draw_text_mut(&mut base, color, x, y, scale, &font, &text);
                }
                "top-left" => {
                    draw_text_mut(&mut base, color, margin, margin, scale, &font, &text);
                }
                "top-right" => {
                    let x = img_w as i32 - text_width - margin;
                    draw_text_mut(&mut base, color, x, margin, scale, &font, &text);
                }
                "bottom-left" => {
                    let y = img_h as i32 - text_height - margin;
                    draw_text_mut(&mut base, color, margin, y, scale, &font, &text);
                }
                "bottom-right" => {
                    let x = img_w as i32 - text_width - margin;
                    let y = img_h as i32 - text_height - margin;
                    draw_text_mut(&mut base, color, x, y, scale, &font, &text);
                }
                "tiled" => {
                    let step_x = text_width + WATERMARK_TILE_SPACING_PX;
                    let step_y = text_height + WATERMARK_TILE_SPACING_PX;
                    let mut y = margin;
                    while y < img_h as i32 {
                        let mut x = margin;
                        while x < img_w as i32 {
                            draw_text_mut(&mut base, color, x, y, scale, &font, &text);
                            x += step_x;
                        }
                        y += step_y;
                    }
                }
                _ => {
                    let x = (img_w as i32 - text_width) / 2;
                    let y = (img_h as i32 - text_height) / 2;
                    draw_text_mut(&mut base, color, x, y, scale, &font, &text);
                }
            }

            let result_img = DynamicImage::ImageRgba8(base);
            let ext = get_extension(input_path);
            let stem = file_stem(input_path);
            let output_path = out_dir.join(format!("{}-watermarked.{}", stem, ext));

            save_in_original_format(&result_img, input_path, &output_path)?;
            Ok((
                output_path.to_string_lossy().to_string(),
                Some((img_w, img_h, img_w, img_h)),
            ))
        },
    )
}

// --- Image Watermark ---

/// Overlay a logo/image watermark on target images with configurable position, opacity, and scale.
#[allow(clippy::too_many_arguments)]
pub fn add_image_watermark(
    input_paths: Vec<String>,
    watermark_path: String,
    position: String,
    opacity: f32,
    scale: f32,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    // Load the watermark image once (shared across all target images)
    let watermark_img = match load_image(&watermark_path) {
        Ok(img) => img.to_rgba8(),
        Err(e) => {
            return BatchProgress::all_failed(
                &input_paths,
                format!("Cannot load watermark image: {}", e),
            )
        }
    };
    let (wm_orig_w, wm_orig_h) = (watermark_img.width(), watermark_img.height());

    if wm_orig_w == 0 || wm_orig_h == 0 {
        return BatchProgress::all_failed(
            &input_paths,
            "Watermark image has zero dimensions".to_string(),
        );
    }

    let opacity_clamped = opacity.clamp(0.0, 1.0);

    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let img = load_image(input_path)?;
            let (img_w, img_h) = (img.width(), img.height());
            let mut base = img.to_rgba8();

            // Scale watermark relative to target image width
            let target_wm_w = ((img_w as f32) * scale.clamp(0.01, 1.0)) as u32;
            let aspect_ratio = wm_orig_h as f32 / wm_orig_w as f32;
            let target_wm_h = (target_wm_w as f32 * aspect_ratio) as u32;

            if target_wm_w == 0 || target_wm_h == 0 {
                return Err("Watermark scaled dimensions are zero".to_string());
            }

            let resized_wm = image::imageops::resize(
                &watermark_img,
                target_wm_w,
                target_wm_h,
                image::imageops::FilterType::Lanczos3,
            );

            // Apply opacity to the watermark alpha channel (mutate in-place, no clone needed)
            let mut wm_with_opacity = resized_wm;
            for pixel in wm_with_opacity.pixels_mut() {
                pixel[3] = (pixel[3] as f32 * opacity_clamped) as u8;
            }

            let margin = WATERMARK_MARGIN_PX as i64;

            let overlay_at = |base_img: &mut image::RgbaImage, x: i64, y: i64| {
                image::imageops::overlay(base_img, &wm_with_opacity, x, y);
            };

            match position.as_str() {
                "center" => {
                    let x = (img_w as i64 - target_wm_w as i64) / 2;
                    let y = (img_h as i64 - target_wm_h as i64) / 2;
                    overlay_at(&mut base, x, y);
                }
                "top-left" => {
                    overlay_at(&mut base, margin, margin);
                }
                "top-right" => {
                    let x = img_w as i64 - target_wm_w as i64 - margin;
                    overlay_at(&mut base, x, margin);
                }
                "bottom-left" => {
                    let y = img_h as i64 - target_wm_h as i64 - margin;
                    overlay_at(&mut base, margin, y);
                }
                "bottom-right" => {
                    let x = img_w as i64 - target_wm_w as i64 - margin;
                    let y = img_h as i64 - target_wm_h as i64 - margin;
                    overlay_at(&mut base, x, y);
                }
                "tiled" => {
                    let step_x = target_wm_w as i64 + WATERMARK_TILE_SPACING_PX as i64;
                    let step_y = target_wm_h as i64 + WATERMARK_TILE_SPACING_PX as i64;
                    let mut y = margin;
                    while y < img_h as i64 {
                        let mut x = margin;
                        while x < img_w as i64 {
                            overlay_at(&mut base, x, y);
                            x += step_x;
                        }
                        y += step_y;
                    }
                }
                _ => {
                    let x = (img_w as i64 - target_wm_w as i64) / 2;
                    let y = (img_h as i64 - target_wm_h as i64) / 2;
                    overlay_at(&mut base, x, y);
                }
            }

            let result_img = DynamicImage::ImageRgba8(base);
            let ext = get_extension(input_path);
            let stem = file_stem(input_path);
            let output_path = out_dir.join(format!("{}-watermarked.{}", stem, ext));

            save_in_original_format(&result_img, input_path, &output_path)?;
            Ok((
                output_path.to_string_lossy().to_string(),
                Some((img_w, img_h, img_w, img_h)),
            ))
        },
    )
}

// --- Lossless Optimize ---

pub fn optimize_lossless(
    input_paths: Vec<String>,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let ext = get_extension(input_path);
            let stem = file_stem(input_path);

            let output_path_str = match ext.as_str() {
                "png" => {
                    let input_data = fs::read(input_path)
                        .map_err(|e| format!("Cannot read '{}': {}", input_path, e))?;

                    let optimized =
                        oxipng::optimize_from_memory(&input_data, &oxipng::Options::from_preset(4))
                            .map_err(|e| format!("PNG optimization failed: {}", e))?;

                    let output_path = out_dir.join(format!("{}-optimized.png", stem));
                    fs::write(&output_path, &optimized)
                        .map_err(|e| format!("Cannot write optimized PNG: {}", e))?;

                    output_path.to_string_lossy().to_string()
                }
                "jpg" | "jpeg" => {
                    // JPEG is inherently lossy; re-encode at max quality (100) to minimize
                    // additional generation loss while still rewriting clean Huffman tables.
                    let img = load_image(input_path)?;
                    let output_path = out_dir.join(format!("{}-optimized.jpg", stem));
                    let mut out = std::fs::File::create(&output_path)
                        .map_err(|e| format!("Cannot create optimized JPEG: {}", e))?;
                    let mut encoder =
                        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 100);
                    encoder
                        .encode_image(&img)
                        .map_err(|e| format!("Cannot save optimized JPEG: {}", e))?;
                    output_path.to_string_lossy().to_string()
                }
                _ => return Err(format!("Unsupported format for optimization: {}", ext)),
            };

            Ok((output_path_str, None))
        },
    )
}

// --- Crop ---

fn parse_ratio(ratio: &str) -> Option<(f64, f64)> {
    let parts: Vec<&str> = ratio.split(':').collect();
    if parts.len() == 2 {
        if let (Ok(w), Ok(h)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
            if w > 0.0 && h > 0.0 {
                return Some((w, h));
            }
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
pub fn crop_images(
    input_paths: Vec<String>,
    ratio: String,
    anchor: String,
    target_width: u32,
    target_height: u32,
    crop_x: Option<u32>,
    crop_y: Option<u32>,
    output_dir: String,
    app_handle: tauri::AppHandle,
    cancel: Arc<AtomicBool>,
) -> BatchProgress {
    batch_process(
        &input_paths,
        &output_dir,
        &app_handle,
        &cancel,
        |input_path, out_dir| {
            let img = load_image(input_path)?;
            let (orig_w, orig_h) = (img.width(), img.height());

            // When explicit crop_x/crop_y are provided, use them directly
            // (free-form rectangle drawn by the user on the preview)
            if let (Some(cx), Some(cy)) = (crop_x, crop_y) {
                let cw = target_width.min(orig_w.saturating_sub(cx));
                let ch = target_height.min(orig_h.saturating_sub(cy));
                if cw == 0 || ch == 0 {
                    return Err("Crop dimensions cannot be zero".to_string());
                }
                let cropped = img.crop_imm(cx.min(orig_w), cy.min(orig_h), cw, ch);
                let ext = get_extension(input_path);
                let stem = file_stem(input_path);
                let output_path = out_dir.join(format!("{}-cropped.{}", stem, ext));
                save_in_original_format(&cropped, input_path, &output_path)?;
                return Ok((
                    output_path.to_string_lossy().to_string(),
                    Some((orig_w, orig_h, cw, ch)),
                ));
            }

            let (crop_w, crop_h) = if ratio == "free" {
                (target_width.min(orig_w), target_height.min(orig_h))
            } else if let Some((rw, rh)) = parse_ratio(&ratio) {
                let scale_w = orig_w as f64 / rw;
                let scale_h = orig_h as f64 / rh;
                let scale = scale_w.min(scale_h);
                let cw = (rw * scale).round() as u32;
                let ch = (rh * scale).round() as u32;
                (cw.min(orig_w), ch.min(orig_h))
            } else {
                return Err(format!("Invalid crop ratio: {}", ratio));
            };

            if crop_w == 0 || crop_h == 0 {
                return Err("Crop dimensions cannot be zero".to_string());
            }

            let (x, y) = match anchor.as_str() {
                "top-left" => (0, 0),
                "top-right" => (orig_w.saturating_sub(crop_w), 0),
                "bottom-left" => (0, orig_h.saturating_sub(crop_h)),
                "bottom-right" => (orig_w.saturating_sub(crop_w), orig_h.saturating_sub(crop_h)),
                _ => (
                    (orig_w.saturating_sub(crop_w)) / 2,
                    (orig_h.saturating_sub(crop_h)) / 2,
                ),
            };

            let cropped = img.crop_imm(x, y, crop_w, crop_h);

            let ext = get_extension(input_path);
            let stem = file_stem(input_path);
            let output_path = out_dir.join(format!("{}-cropped.{}", stem, ext));

            save_in_original_format(&cropped, input_path, &output_path)?;
            Ok((
                output_path.to_string_lossy().to_string(),
                Some((orig_w, orig_h, crop_w, crop_h)),
            ))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_failed_sets_every_result_to_error() {
        let paths = vec!["a.png".to_string(), "b.png".to_string()];
        let bp = BatchProgress::all_failed(&paths, "boom".to_string());
        assert_eq!(bp.completed, 0);
        assert_eq!(bp.total, 2);
        assert!(bp.results.iter().all(|r| !r.success));
        assert!(bp
            .results
            .iter()
            .all(|r| r.error.as_deref() == Some("boom")));
    }

    #[test]
    fn build_result_success() {
        let r = build_result(
            "/tmp/photo.jpg",
            Ok("/tmp/out/photo-compressed.webp".to_string()),
            Some((1920, 1080, 800, 600)),
        );
        assert!(r.success);
        assert!(r.error.is_none());
        assert_eq!(r.input_width, 1920);
        assert_eq!(r.output_width, 800);
    }

    #[test]
    fn build_result_failure() {
        let r = build_result("/tmp/bad.jpg", Err("decode error".to_string()), None);
        assert!(!r.success);
        assert_eq!(r.error.as_deref(), Some("decode error"));
        assert_eq!(r.output_path, String::new());
    }

    #[test]
    fn generate_thumbnails_downscales_and_marks_failures() {
        // Write a large temp PNG so the source bitmap dwarfs the thumbnail.
        let path = std::env::temp_dir().join("rustine_thumb_test.png");
        let path_str = path.to_string_lossy().to_string();
        DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1024,
            1024,
            Rgba([200, 30, 30, 255]),
        ))
        .save(&path)
        .unwrap();

        let missing = "/nonexistent/definitely_not_here.png".to_string();
        let res = generate_thumbnails(&[path_str.clone(), missing.clone()]);
        assert_eq!(res.len(), 2);

        let ok = res.iter().find(|t| t.path == path_str).unwrap();
        let b64 = ok.thumbnail_b64.as_ref().expect("thumbnail should encode");
        // A 256px JPEG is far smaller than the 1024x1024 RGBA source.
        assert!(
            b64.len() < 50_000,
            "thumbnail unexpectedly large: {}",
            b64.len()
        );

        let bad = res.iter().find(|t| t.path == missing).unwrap();
        assert!(bad.thumbnail_b64.is_none());

        let _ = std::fs::remove_file(&path);
    }
}
