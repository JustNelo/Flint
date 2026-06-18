mod color_ops;
mod favicon_ops;
mod gif_ops;
mod image_ops;
mod metadata_ops;
mod pdf_builder_ops;
mod pdf_ops;
mod pdf_split_ops;
mod pdf_watermark_ops;
mod progress;
mod qr_ops;
mod rename_ops;
mod sprite_ops;
mod svg_ops;
mod utils;

use color_ops::PaletteResult;
use favicon_ops::FaviconResult;
use gif_ops::AnimationResult;
use image_ops::BatchProgress;
use metadata_ops::ImageMetadata;
use pdf_builder_ops::{MergePdfOptions, MergePdfResult, PageThumbnail, PdfBuilderItem};
use pdf_ops::{
    ImagesToPdfResult, PdfCompressResult, PdfExtractionResult, PdfProtectResult, PdfToImagesResult,
};
use pdf_split_ops::PdfSplitResult;
use pdf_watermark_ops::PdfWatermarkResult;
use pdfium_render::prelude::Pdfium;
use qr_ops::QrResult;
use rename_ops::RenameResult;
use sprite_ops::SpriteSheetResult;
use std::path::{Component, Path};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use svg_ops::SvgRasterizeResult;
use tauri::Manager;

/// Thread-safe wrapper around `Pdfium`.
///
/// SAFETY: Pdfium is NOT safe for concurrent use. The `thread_safe` feature of
/// pdfium-render only takes its global lock once at `FPDF_InitLibrary` and holds
/// it until `FPDF_DestroyLibrary` — it does **not** serialize individual calls on
/// a shared instance. We therefore wrap the instance in our own `Mutex` and route
/// every pdfium operation through `lock()`, guaranteeing that only one thread ever
/// calls into pdfium at a time. With that guarantee, sharing the instance across
/// threads (`Send` + `Sync`) is sound.
struct SendPdfium(Mutex<Pdfium>);
unsafe impl Send for SendPdfium {}
unsafe impl Sync for SendPdfium {}

impl SendPdfium {
    /// Acquire exclusive access to the shared Pdfium instance for the duration of
    /// a single operation. Recovers from a poisoned lock (left by a previously
    /// panicking operation) so PDF features keep working.
    fn lock(&self) -> MutexGuard<'_, Pdfium> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Pdfium instance, bound once at startup and shared via tauri::State.
pub struct PdfiumState(Option<Arc<SendPdfium>>);

/// Returns a cloned Arc to the shared Pdfium instance, or an error if unavailable.
fn require_pdfium(state: &PdfiumState) -> Result<Arc<SendPdfium>, String> {
    state
        .0
        .as_ref()
        .cloned()
        .ok_or_else(|| "Pdfium library not found — PDF features are unavailable. Please reinstall the application.".to_string())
}

/// Shared cancellation flag for batch operations.
/// Set to `true` to request early termination of the current batch.
pub struct CancellationToken(pub Arc<AtomicBool>);

fn resolve_pdfium_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let lib_name = if cfg!(target_os = "windows") {
        "pdfium.dll"
    } else if cfg!(target_os = "macos") {
        "libpdfium.dylib"
    } else {
        "libpdfium.so"
    };

    let candidates: Vec<std::path::PathBuf> = vec![
        app_handle
            .path()
            .resource_dir()
            .ok()
            .map(|d| d.join(lib_name)),
        app_handle
            .path()
            .resource_dir()
            .ok()
            .map(|d| d.join("resources").join(lib_name)),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join(lib_name))),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("resources").join(lib_name))),
    ]
    .into_iter()
    .flatten()
    .collect();

    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }

    Err(format!(
        "Pdfium library not found. Searched: {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Returns the set of base directories the app is allowed to access.
/// Mirrors the `assetProtocol.scope` from `tauri.conf.json`.
/// Computed once and cached for the lifetime of the process.
static ALLOWED_BASE_DIRS: LazyLock<Vec<std::path::PathBuf>> = LazyLock::new(|| {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home);
    }
    if let Some(tmp) = std::env::var_os("TEMP")
        .or_else(|| std::env::var_os("TMPDIR"))
        .map(std::path::PathBuf::from)
    {
        dirs.push(tmp);
    }
    dirs.push(std::env::temp_dir());
    dirs.into_iter()
        .filter_map(|d| std::fs::canonicalize(&d).ok().or(Some(d)))
        .collect()
});

fn validate_path(path: &str) -> Result<(), String> {
    if path.contains('\0') {
        return Err(format!("Path contains null byte: {}", path));
    }
    let p = Path::new(path);
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("Path traversal detected: {}", path));
    }
    if !p.is_absolute() {
        return Err(format!("Only absolute paths are allowed: {}", path));
    }
    // Resolve symlinks on the path itself or its nearest existing ancestor
    // to ensure the final target is within allowed directories.
    // Fail-closed: if no ancestor exists or canonicalization fails, reject.
    let canonical = if p.exists() {
        std::fs::canonicalize(p).map_err(|e| format!("Cannot canonicalize '{}': {}", path, e))?
    } else {
        let ancestor = p
            .ancestors()
            .skip(1)
            .find(|a| a.exists())
            .ok_or_else(|| format!("No existing ancestor for path: {}", path))?;
        std::fs::canonicalize(ancestor)
            .map_err(|e| format!("Cannot canonicalize ancestor of '{}': {}", path, e))?
    };
    let is_allowed = ALLOWED_BASE_DIRS
        .iter()
        .any(|base| canonical.starts_with(base));
    if !is_allowed {
        return Err(format!(
            "Path resolves outside allowed directories: {}",
            path
        ));
    }
    Ok(())
}

fn validate_paths(paths: &[String]) -> Result<(), String> {
    for p in paths {
        validate_path(p)?;
    }
    Ok(())
}

/// Run a CPU-bound closure on the blocking pool and surface join errors
/// uniformly. Every Tauri command in this file goes through this so that
/// `Task failed: <reason>` errors look the same across the app.
async fn run_blocking<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("Task failed: {}", e))
}

/// Reset the shared cancellation flag and return a clone for the worker thread.
fn arm_cancel_token(token: &tauri::State<'_, CancellationToken>) -> Arc<AtomicBool> {
    let cancel = token.0.clone();
    cancel.store(false, Ordering::Relaxed);
    cancel
}

#[tauri::command]
async fn compress_webp(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    quality: f32,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let cancel = arm_cancel_token(&token);
    run_blocking(move || {
        image_ops::compress_to_webp(input_paths, quality, output_dir, app_handle, cancel)
    })
    .await
}

#[tauri::command]
async fn compress_jpeg(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    quality: u8,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let cancel = arm_cancel_token(&token);
    run_blocking(move || {
        image_ops::compress_to_jpeg(input_paths, quality, output_dir, app_handle, cancel)
    })
    .await
}

#[tauri::command]
async fn compress_avif(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    quality: u8,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let cancel = arm_cancel_token(&token);
    run_blocking(move || {
        image_ops::compress_to_avif(input_paths, quality, output_dir, app_handle, cancel)
    })
    .await
}

#[tauri::command]
async fn convert_images(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    output_format: String,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let cancel = arm_cancel_token(&token);
    run_blocking(move || {
        image_ops::convert_images(input_paths, output_format, output_dir, app_handle, cancel)
    })
    .await
}

#[tauri::command]
async fn generate_image_thumbnails(
    input_paths: Vec<String>,
) -> Result<Vec<image_ops::ImageThumbnail>, String> {
    validate_paths(&input_paths)?;
    run_blocking(move || image_ops::generate_thumbnails(&input_paths)).await
}

#[tauri::command]
async fn extract_pdf_images(
    app_handle: tauri::AppHandle,
    pdfium_state: tauri::State<'_, PdfiumState>,
    pdf_path: String,
    output_dir: String,
    output_stem: Option<String>,
) -> Result<PdfExtractionResult, String> {
    validate_path(&pdf_path)?;
    validate_path(&output_dir)?;
    let output_stem = output_stem.map(|s| utils::sanitize_stem(&s)).transpose()?;
    let pdfium = require_pdfium(&pdfium_state)?;
    run_blocking(move || {
        let guard = pdfium.lock();
        pdf_ops::extract_images_from_pdf(
            &pdf_path,
            &output_dir,
            &guard,
            output_stem.as_deref(),
            &app_handle,
        )
    })
    .await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn resize_images(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    mode: String,
    width: u32,
    height: u32,
    percentage: u32,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let cancel = arm_cancel_token(&token);
    run_blocking(move || {
        image_ops::resize_images(
            input_paths,
            mode,
            width,
            height,
            percentage,
            output_dir,
            app_handle,
            cancel,
        )
    })
    .await
}

#[tauri::command]
async fn strip_metadata(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let cancel = arm_cancel_token(&token);
    run_blocking(move || image_ops::strip_metadata(input_paths, output_dir, app_handle, cancel))
        .await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn add_watermark(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    text: String,
    position: String,
    opacity: f32,
    font_size: f32,
    color: String,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let font_size = font_size.clamp(1.0, 500.0);
    let opacity = opacity.clamp(0.0, 1.0);
    let cancel = arm_cancel_token(&token);
    run_blocking(move || {
        image_ops::add_watermark(
            input_paths,
            text,
            position,
            opacity,
            font_size,
            color,
            output_dir,
            app_handle,
            cancel,
        )
    })
    .await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn add_image_watermark(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    watermark_path: String,
    position: String,
    opacity: f32,
    scale: f32,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_path(&watermark_path)?;
    validate_paths(&input_paths)?;
    let opacity = opacity.clamp(0.0, 1.0);
    // NOTE: image_ops::add_image_watermark re-clamps to (0.01, 1.0) internally.
    let scale = scale.clamp(0.01, 1.0);
    let cancel = arm_cancel_token(&token);
    run_blocking(move || {
        image_ops::add_image_watermark(
            input_paths,
            watermark_path,
            position,
            opacity,
            scale,
            output_dir,
            app_handle,
            cancel,
        )
    })
    .await
}

#[tauri::command]
async fn images_to_pdf(
    app_handle: tauri::AppHandle,
    input_paths: Vec<String>,
    output_path: String,
) -> Result<ImagesToPdfResult, String> {
    validate_path(&output_path)?;
    validate_paths(&input_paths)?;
    run_blocking(move || pdf_ops::images_to_pdf(input_paths, &output_path, &app_handle)).await
}

#[tauri::command]
async fn read_metadata(file_path: String) -> Result<ImageMetadata, String> {
    validate_path(&file_path)?;
    run_blocking(move || metadata_ops::read_image_metadata(&file_path)).await?
}

#[tauri::command]
async fn get_pdf_page_count(
    pdfium_state: tauri::State<'_, PdfiumState>,
    pdf_path: String,
) -> Result<usize, String> {
    validate_path(&pdf_path)?;
    let pdfium = require_pdfium(&pdfium_state)?;
    run_blocking(move || {
        let guard = pdfium.lock();
        pdf_builder_ops::get_pdf_page_count(&pdf_path, &guard)
    })
    .await?
}

#[tauri::command]
async fn generate_pdf_thumbnails(
    pdfium_state: tauri::State<'_, PdfiumState>,
    file_paths: Vec<String>,
    start_page: Option<usize>,
    max_pages: Option<usize>,
) -> Result<Vec<PageThumbnail>, String> {
    validate_paths(&file_paths)?;
    let pdfium = require_pdfium(&pdfium_state)?;
    run_blocking(move || {
        let guard = pdfium.lock();
        pdf_builder_ops::generate_thumbnails_batch(file_paths, &guard, start_page, max_pages)
    })
    .await
}

#[tauri::command]
async fn merge_to_pdf(
    app_handle: tauri::AppHandle,
    items: Vec<PdfBuilderItem>,
    options: MergePdfOptions,
) -> Result<MergePdfResult, String> {
    validate_path(&options.output_path)?;
    let item_paths: Vec<String> = items.iter().map(|i| i.source_path.clone()).collect();
    validate_paths(&item_paths)?;
    run_blocking(move || pdf_builder_ops::merge_to_pdf(items, options, &app_handle)).await
}

#[tauri::command]
async fn optimize_images(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let cancel = arm_cancel_token(&token);
    run_blocking(move || image_ops::optimize_lossless(input_paths, output_dir, app_handle, cancel))
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn crop_images(
    app_handle: tauri::AppHandle,
    token: tauri::State<'_, CancellationToken>,
    input_paths: Vec<String>,
    ratio: String,
    anchor: String,
    width: u32,
    height: u32,
    crop_x: Option<u32>,
    crop_y: Option<u32>,
    output_dir: String,
) -> Result<BatchProgress, String> {
    validate_path(&output_dir)?;
    validate_paths(&input_paths)?;
    let width = width.max(1);
    let height = height.max(1);
    let cancel = arm_cancel_token(&token);
    run_blocking(move || {
        image_ops::crop_images(
            input_paths,
            ratio,
            anchor,
            width,
            height,
            crop_x,
            crop_y,
            output_dir,
            app_handle,
            cancel,
        )
    })
    .await
}

#[tauri::command]
async fn pdf_to_images(
    app_handle: tauri::AppHandle,
    pdfium_state: tauri::State<'_, PdfiumState>,
    pdf_path: String,
    output_dir: String,
    format: String,
    dpi: u32,
    output_stem: Option<String>,
) -> Result<PdfToImagesResult, String> {
    validate_path(&pdf_path)?;
    validate_path(&output_dir)?;
    let output_stem = output_stem.map(|s| utils::sanitize_stem(&s)).transpose()?;
    let dpi = dpi.clamp(72, 1200);
    let pdfium = require_pdfium(&pdfium_state)?;
    run_blocking(move || {
        let guard = pdfium.lock();
        pdf_ops::pdf_to_images(
            &pdf_path,
            &output_dir,
            &guard,
            &format,
            dpi,
            output_stem.as_deref(),
            &app_handle,
        )
    })
    .await
}

#[tauri::command]
async fn split_pdf(
    app_handle: tauri::AppHandle,
    pdf_path: String,
    ranges: String,
    output_dir: String,
    output_stem: Option<String>,
) -> Result<PdfSplitResult, String> {
    validate_path(&pdf_path)?;
    validate_path(&output_dir)?;
    let output_stem = output_stem.map(|s| utils::sanitize_stem(&s)).transpose()?;
    run_blocking(move || {
        pdf_split_ops::split_pdf(
            &pdf_path,
            &ranges,
            &output_dir,
            output_stem.as_deref(),
            &app_handle,
        )
    })
    .await
}

#[tauri::command]
async fn extract_palette(image_path: String, num_colors: usize) -> Result<PaletteResult, String> {
    validate_path(&image_path)?;
    run_blocking(move || color_ops::extract_palette(&image_path, num_colors)).await?
}

#[tauri::command]
async fn compress_pdf_cmd(
    app_handle: tauri::AppHandle,
    pdf_path: String,
    quality: u8,
    output_dir: String,
) -> Result<PdfCompressResult, String> {
    validate_path(&pdf_path)?;
    validate_path(&output_dir)?;
    run_blocking(move || pdf_ops::compress_pdf(&pdf_path, quality, &output_dir, &app_handle)).await
}

#[tauri::command]
async fn generate_favicons(
    app_handle: tauri::AppHandle,
    image_path: String,
    output_dir: String,
) -> Result<FaviconResult, String> {
    validate_path(&image_path)?;
    validate_path(&output_dir)?;
    run_blocking(move || favicon_ops::generate_favicons(&image_path, &output_dir, &app_handle))
        .await
}

#[tauri::command]
async fn create_gif(
    app_handle: tauri::AppHandle,
    image_paths: Vec<String>,
    delay_ms: u16,
    loop_count: u16,
    output_dir: String,
) -> Result<AnimationResult, String> {
    validate_paths(&image_paths)?;
    validate_path(&output_dir)?;
    let delay_ms = delay_ms.max(10);
    run_blocking(move || {
        gif_ops::create_gif(&image_paths, delay_ms, loop_count, &output_dir, &app_handle)
    })
    .await
}

#[tauri::command]
async fn generate_spritesheet(
    app_handle: tauri::AppHandle,
    image_paths: Vec<String>,
    columns: u32,
    padding: u32,
    output_dir: String,
) -> Result<SpriteSheetResult, String> {
    validate_paths(&image_paths)?;
    validate_path(&output_dir)?;
    let columns = columns.clamp(1, 100);
    let padding = padding.min(200);
    run_blocking(move || {
        sprite_ops::generate_spritesheet(&image_paths, columns, padding, &output_dir, &app_handle)
    })
    .await
}

#[tauri::command]
async fn protect_pdf_cmd(
    app_handle: tauri::AppHandle,
    pdf_path: String,
    password: String,
    output_dir: String,
) -> Result<PdfProtectResult, String> {
    validate_path(&pdf_path)?;
    validate_path(&output_dir)?;
    run_blocking(move || pdf_ops::protect_pdf(&pdf_path, &password, &output_dir, &app_handle)).await
}

#[tauri::command]
async fn unlock_pdf_cmd(
    pdfium_state: tauri::State<'_, PdfiumState>,
    pdf_path: String,
    password: String,
    output_dir: String,
) -> Result<PdfProtectResult, String> {
    validate_path(&pdf_path)?;
    validate_path(&output_dir)?;
    let pdfium = require_pdfium(&pdfium_state)?;
    run_blocking(move || {
        let guard = pdfium.lock();
        pdf_ops::unlock_pdf(&guard, &pdf_path, &password, &output_dir)
    })
    .await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn watermark_pdf_text_cmd(
    app_handle: tauri::AppHandle,
    pdf_path: String,
    text: String,
    position: String,
    opacity: f32,
    font_size: f32,
    color: String,
    output_dir: String,
) -> Result<PdfWatermarkResult, String> {
    validate_path(&pdf_path)?;
    validate_path(&output_dir)?;
    run_blocking(move || {
        pdf_watermark_ops::watermark_pdf_text(
            &pdf_path,
            &text,
            &position,
            opacity,
            font_size,
            &color,
            &output_dir,
            &app_handle,
        )
    })
    .await
}

#[tauri::command]
async fn watermark_pdf_image_cmd(
    app_handle: tauri::AppHandle,
    image_path: String,
    pdf_path: String,
    position: String,
    opacity: f32,
    scale: f32,
    output_dir: String,
) -> Result<PdfWatermarkResult, String> {
    validate_path(&pdf_path)?;
    validate_path(&image_path)?;
    validate_path(&output_dir)?;
    run_blocking(move || {
        pdf_watermark_ops::watermark_pdf_image(
            &pdf_path,
            &image_path,
            &position,
            opacity,
            scale,
            &output_dir,
            &app_handle,
        )
    })
    .await
}

#[tauri::command]
async fn bulk_rename_cmd(
    app_handle: tauri::AppHandle,
    input_paths: Vec<String>,
    pattern: String,
    start_index: u32,
    output_dir: String,
) -> Result<RenameResult, String> {
    validate_paths(&input_paths)?;
    validate_path(&output_dir)?;
    run_blocking(move || {
        rename_ops::bulk_rename(
            &input_paths,
            &pattern,
            start_index,
            &output_dir,
            &app_handle,
        )
    })
    .await
}

#[tauri::command]
async fn generate_qr_cmd(text: String, size: u32, output_dir: String) -> Result<QrResult, String> {
    validate_path(&output_dir)?;
    let size = size.clamp(64, 4096);
    run_blocking(move || qr_ops::generate_qr(&text, size, &output_dir)).await
}

#[tauri::command]
async fn generate_qr_preview(text: String, size: u32) -> Result<String, String> {
    run_blocking(move || qr_ops::generate_qr_base64(&text, size)).await?
}

#[tauri::command]
async fn rasterize_svg_cmd(
    input_path: String,
    target_width: u32,
    output_format: String,
    output_dir: String,
) -> Result<SvgRasterizeResult, String> {
    validate_path(&input_path)?;
    validate_path(&output_dir)?;
    let target_width = target_width.clamp(16, 8192);
    run_blocking(move || {
        svg_ops::rasterize_svg(&input_path, target_width, &output_format, &output_dir)
    })
    .await?
}

#[tauri::command]
fn cancel_processing(token: tauri::State<'_, CancellationToken>) {
    (*token).0.store(true, Ordering::Relaxed);
}

/// Upper bound on file size accepted by `image_to_base64`.
/// Encoding inflates by ~4/3, then crosses the IPC layer as a UTF-8 string —
/// values above this risk OOM and UI freezes. For preview/display, prefer
/// `convertFileSrc` on the frontend (see `safeAssetUrl` in `src/lib/utils.ts`).
const IMAGE_TO_BASE64_MAX_BYTES: u64 = 25 * 1024 * 1024;

#[tauri::command]
async fn image_to_base64(image_path: String) -> Result<String, String> {
    validate_path(&image_path)?;
    let size = std::fs::metadata(&image_path)
        .map_err(|e| format!("Cannot stat file: {}", e))?
        .len();
    if size > IMAGE_TO_BASE64_MAX_BYTES {
        return Err(format!(
            "File too large for base64 encoding ({} bytes, max {}). Use convertFileSrc instead.",
            size, IMAGE_TO_BASE64_MAX_BYTES
        ));
    }
    run_blocking(move || {
        let bytes = std::fs::read(&image_path).map_err(|e| format!("Cannot read file: {}", e))?;
        let ext = Path::new(&image_path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_else(|| "png".to_string());
        let mime = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "ico" => "image/x-icon",
            "svg" => "image/svg+xml",
            "tiff" | "tif" => "image/tiff",
            _ => "application/octet-stream",
        };
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        Ok(format!("data:{};base64,{}", mime, b64))
    })
    .await?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            compress_webp,
            compress_jpeg,
            compress_avif,
            convert_images,
            generate_image_thumbnails,
            extract_pdf_images,
            resize_images,
            strip_metadata,
            add_watermark,
            add_image_watermark,
            optimize_images,
            crop_images,
            images_to_pdf,
            read_metadata,
            get_pdf_page_count,
            generate_pdf_thumbnails,
            merge_to_pdf,
            pdf_to_images,
            split_pdf,
            extract_palette,
            compress_pdf_cmd,
            generate_favicons,
            create_gif,
            generate_spritesheet,
            protect_pdf_cmd,
            unlock_pdf_cmd,
            watermark_pdf_text_cmd,
            watermark_pdf_image_cmd,
            image_to_base64,
            generate_qr_cmd,
            generate_qr_preview,
            bulk_rename_cmd,
            rasterize_svg_cmd,
            cancel_processing
        ])
        .setup(|app| {
            let png_bytes = include_bytes!("../icons/icon.png");
            if let Ok(img) = image::load_from_memory(png_bytes) {
                let rgba = img.to_rgba8();
                let (w, h) = (rgba.width(), rgba.height());
                let icon = tauri::image::Image::new_owned(rgba.into_raw(), w, h);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_icon(icon);
                }
            }

            // Resolve and bind pdfium library once at startup
            let pdfium_instance = match resolve_pdfium_path(app.handle()) {
                Ok(path) => match Pdfium::bind_to_library(&path) {
                    Ok(bindings) => {
                        eprintln!("Pdfium library bound successfully from: {}", path);
                        Some(Arc::new(SendPdfium(Mutex::new(Pdfium::new(bindings)))))
                    }
                    Err(e) => {
                        eprintln!(
                            "Warning: Pdfium found at {} but binding failed: {} — PDF features will be unavailable",
                            path, e
                        );
                        None
                    }
                },
                Err(e) => {
                    eprintln!("Warning: {} — PDF features will be unavailable", e);
                    None
                }
            };
            app.manage(PdfiumState(pdfium_instance));
            app.manage(CancellationToken(Arc::new(AtomicBool::new(false))));

            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Fatal: failed to start Rust-ine — {}", e);
            std::process::exit(1);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_path_rejects_relative() {
        assert!(validate_path("images/photo.png").is_err());
    }

    #[test]
    fn validate_path_rejects_traversal() {
        assert!(validate_path("C:\\Users\\..\\admin\\secret.txt").is_err());
        assert!(validate_path("/home/../etc/passwd").is_err());
    }

    #[test]
    fn validate_path_accepts_absolute() {
        // Use a path within an allowed directory (home or temp)
        if cfg!(windows) {
            if let Some(home) = dirs::home_dir() {
                let p = home.join("photo.png");
                assert!(validate_path(&p.to_string_lossy()).is_ok());
            }
        } else {
            let tmp = std::env::temp_dir().join("photo.png");
            assert!(validate_path(&tmp.to_string_lossy()).is_ok());
        }
    }

    #[test]
    fn validate_paths_fails_on_any_bad() {
        let paths = if cfg!(windows) {
            vec![
                "C:\\Users\\test\\ok.png".to_string(),
                "images\\relative.png".to_string(),
            ]
        } else {
            vec![
                "/home/test/ok.png".to_string(),
                "images/relative.png".to_string(),
            ]
        };
        assert!(validate_paths(&paths).is_err());
    }

    #[test]
    fn validate_path_rejects_non_existing_outside_allowed() {
        // A non-existing path whose nearest ancestor resolves outside allowed dirs
        if cfg!(not(windows)) {
            assert!(validate_path("/opt/evil/non_existing_output").is_err());
            assert!(validate_path("/etc/evil_output_dir/file.png").is_err());
            assert!(validate_path("/var/lib/sneaky/out").is_err());
        }
    }

    #[test]
    fn validate_path_rejects_null_bytes() {
        assert!(validate_path("/home/test/\0evil.png").is_err());
    }
}
