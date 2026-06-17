use image::codecs::jpeg::JpegEncoder;
use lopdf::{dictionary, Document as LopdfDocument, Object, Stream};
use pdfium_render::prelude::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;

use crate::progress::emit_progress_simple;
use crate::utils::{embed_image_as_pdf_page, ensure_output_dir, filename_or_default};

// --- Structs ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PageThumbnail {
    pub id: String,
    pub source_path: String,
    pub page_number: usize,
    pub thumbnail_b64: String,
    pub source_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PdfBuilderItem {
    pub source_path: String,
    pub page_number: Option<usize>,
    pub source_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MergePdfOptions {
    pub page_format: String,
    pub orientation: String,
    pub margin_px: u32,
    pub image_quality: u32,
    pub output_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MergePdfResult {
    pub output_path: String,
    pub page_count: usize,
    pub errors: Vec<String>,
}

// --- Thumbnail generation ---

fn encode_image_to_b64_jpeg(img: &image::DynamicImage, max_width: u32) -> Result<String, String> {
    let owned_resized;
    let to_encode: &image::DynamicImage = if img.width() > max_width {
        owned_resized = img.resize(
            max_width,
            max_width * 2,
            image::imageops::FilterType::Triangle,
        );
        &owned_resized
    } else {
        img
    };

    let mut jpeg_buf: Vec<u8> = Vec::new();
    let mut cursor = Cursor::new(&mut jpeg_buf);
    let encoder = JpegEncoder::new_with_quality(&mut cursor, 50);
    to_encode
        .write_with_encoder(encoder)
        .map_err(|e| format!("JPEG encode failed: {}", e))?;

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&jpeg_buf))
}

pub fn generate_image_thumbnail(path: &str) -> Result<PageThumbnail, String> {
    let img = image::open(path).map_err(|e| format!("Cannot open image '{}': {}", path, e))?;
    let b64 = encode_image_to_b64_jpeg(&img, 120)?;
    let filename = Path::new(path)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("image");

    Ok(PageThumbnail {
        id: format!("img_{}_{}", filename, 0),
        source_path: path.to_string(),
        page_number: 0,
        thumbnail_b64: b64,
        source_type: "image".to_string(),
    })
}

fn generate_pdf_page_thumbnails(
    pdf_path: &str,
    pdfium: &Pdfium,
    start_page: Option<usize>,
    max_pages: Option<usize>,
) -> Result<Vec<PageThumbnail>, String> {
    let document = pdfium
        .load_pdf_from_file(pdf_path, None)
        .map_err(|e| format!("Cannot open PDF '{}': {}", pdf_path, e))?;

    let pdf_stem = Path::new(pdf_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("pdf");

    let total_pages = document.pages().len() as usize;
    // start_page is 1-indexed; default to 1
    let start = start_page.unwrap_or(1).max(1);
    let start_idx = start - 1; // 0-indexed
    let limit = max_pages.unwrap_or(total_pages);
    let end_idx = (start_idx + limit).min(total_pages);

    let capacity = end_idx.saturating_sub(start_idx);
    let mut thumbnails: Vec<PageThumbnail> = Vec::with_capacity(capacity);

    for (page_index, page) in document.pages().iter().enumerate() {
        if page_index < start_idx {
            continue;
        }
        if page_index >= end_idx {
            break;
        }
        let render_result = page.render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(120)
                .set_maximum_height(240),
        );

        match render_result {
            Ok(bitmap) => {
                let dynamic_image = bitmap.as_image();
                match encode_image_to_b64_jpeg(&dynamic_image, 120) {
                    Ok(b64) => {
                        thumbnails.push(PageThumbnail {
                            id: format!("pdf_{}_p{}", pdf_stem, page_index + 1),
                            source_path: pdf_path.to_string(),
                            page_number: page_index + 1,
                            thumbnail_b64: b64,
                            source_type: "pdf".to_string(),
                        });
                    }
                    Err(e) => {
                        thumbnails.push(PageThumbnail {
                            id: format!("pdf_{}_p{}", pdf_stem, page_index + 1),
                            source_path: pdf_path.to_string(),
                            page_number: page_index + 1,
                            thumbnail_b64: String::new(),
                            source_type: "pdf".to_string(),
                        });
                        eprintln!(
                            "Warning: thumbnail encode failed for {} page {}: {}",
                            pdf_path,
                            page_index + 1,
                            e
                        );
                    }
                }
            }
            Err(e) => {
                thumbnails.push(PageThumbnail {
                    id: format!("pdf_{}_p{}", pdf_stem, page_index + 1),
                    source_path: pdf_path.to_string(),
                    page_number: page_index + 1,
                    thumbnail_b64: String::new(),
                    source_type: "pdf".to_string(),
                });
                eprintln!(
                    "Warning: render failed for {} page {}: {}",
                    pdf_path,
                    page_index + 1,
                    e
                );
            }
        }
    }

    Ok(thumbnails)
}

/// Returns the page count of a PDF without rendering any thumbnails.
pub fn get_pdf_page_count(pdf_path: &str, pdfium: &Pdfium) -> Result<usize, String> {
    let document = pdfium
        .load_pdf_from_file(pdf_path, None)
        .map_err(|e| format!("Cannot open PDF '{}': {}", pdf_path, e))?;
    Ok(document.pages().len() as usize)
}

pub fn generate_thumbnails_batch(
    file_paths: Vec<String>,
    pdfium: &Pdfium,
    start_page: Option<usize>,
    max_pages: Option<usize>,
) -> Vec<PageThumbnail> {
    let mut image_paths: Vec<String> = Vec::new();
    let mut pdf_paths: Vec<String> = Vec::new();

    for path in &file_paths {
        let ext = Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if ext == "pdf" {
            pdf_paths.push(path.clone());
        } else {
            image_paths.push(path.clone());
        }
    }

    // Generate image thumbnails in parallel with rayon
    let mut all_thumbnails: Vec<PageThumbnail> = image_paths
        .par_iter()
        .filter_map(|path| generate_image_thumbnail(path).ok())
        .collect();

    // Use the shared Pdfium instance for all PDF thumbnails
    for pdf_path in &pdf_paths {
        match generate_pdf_page_thumbnails(pdf_path, pdfium, start_page, max_pages) {
            Ok(thumbs) => all_thumbnails.extend(thumbs),
            Err(e) => eprintln!(
                "Warning: PDF thumbnail generation failed for {}: {}",
                pdf_path, e
            ),
        }
    }

    all_thumbnails
}

// --- PDF Merge ---

fn get_page_dimensions(format: &str, orientation: &str) -> (f32, f32) {
    let (w, h) = match format {
        "a4" => (595.28, 841.89),
        "letter" => (612.0, 792.0),
        _ => (595.28, 841.89),
    };

    if orientation == "landscape" {
        (h, w)
    } else {
        (w, h)
    }
}

fn add_image_page(
    doc: &mut LopdfDocument,
    pages_id: lopdf::ObjectId,
    image_path: &str,
    options: &MergePdfOptions,
) -> Result<lopdf::ObjectId, String> {
    let img = image::open(image_path)
        .map_err(|e| format!("Cannot open image '{}': {}", image_path, e))?;
    let (img_w, img_h) = (img.width(), img.height());
    drop(img);

    let (page_w, page_h) = if options.page_format == "fit" {
        (img_w as f32, img_h as f32)
    } else {
        get_page_dimensions(&options.page_format, &options.orientation)
    };

    let quality = options.image_quality.clamp(1, 100) as u8;
    let margin = options.margin_px as f32;

    embed_image_as_pdf_page(doc, pages_id, image_path, page_w, page_h, margin, quality)
}

// Copies a single page from an already-loaded source PDF into the destination.
// The visited map is shared across all pages from the same source document,
// so shared resources (fonts, images, etc.) are only cloned once.
fn copy_pdf_page_from_loaded(
    dest_doc: &mut LopdfDocument,
    pages_id: lopdf::ObjectId,
    source_doc: &LopdfDocument,
    source_path: &str,
    page_number: usize,
    visited: &mut HashMap<lopdf::ObjectId, lopdf::ObjectId>,
) -> Result<lopdf::ObjectId, String> {
    let source_pages = source_doc.get_pages();
    let page_num_u32 = page_number as u32;

    let source_page_id = source_pages.get(&page_num_u32).ok_or_else(|| {
        format!(
            "Page {} not found in '{}' (has {} pages)",
            page_number,
            source_path,
            source_pages.len()
        )
    })?;

    // Always create a fresh page object even if this page was cloned before
    // (e.g. same PDF added twice). Sub-resources (fonts, images) stay shared.
    visited.remove(source_page_id);

    // Clone the entire object tree for this page into the destination document
    let cloned_page_id = deep_clone_object(dest_doc, source_doc, *source_page_id, visited)?;

    // Update the Parent reference to point to our pages catalog
    if let Ok(Object::Dictionary(ref mut dict)) = dest_doc.get_object_mut(cloned_page_id) {
        dict.set("Parent", Object::Reference(pages_id));
    }

    Ok(cloned_page_id)
}

fn deep_clone_object(
    dest: &mut LopdfDocument,
    source: &LopdfDocument,
    obj_id: lopdf::ObjectId,
    visited: &mut HashMap<lopdf::ObjectId, lopdf::ObjectId>,
) -> Result<lopdf::ObjectId, String> {
    // Return cached ID if we already cloned this object (cycle breaker)
    if let Some(&existing_id) = visited.get(&obj_id) {
        return Ok(existing_id);
    }

    let obj = source
        .get_object(obj_id)
        .map_err(|e| format!("Cannot get object {:?}: {}", obj_id, e))?
        .clone();

    // Reserve an ID upfront so recursive calls can reference it
    let new_id = dest.add_object(Object::Null);
    visited.insert(obj_id, new_id);

    let cloned = clone_object_recursive(dest, source, &obj, visited)?;
    dest.objects.insert(new_id, cloned);

    Ok(new_id)
}

fn clone_object_recursive(
    dest: &mut LopdfDocument,
    source: &LopdfDocument,
    obj: &Object,
    visited: &mut HashMap<lopdf::ObjectId, lopdf::ObjectId>,
) -> Result<Object, String> {
    match obj {
        Object::Reference(ref_id) => {
            // Recursively clone the referenced object (visited map prevents cycles)
            let new_id = deep_clone_object(dest, source, *ref_id, visited)?;
            Ok(Object::Reference(new_id))
        }
        Object::Dictionary(dict) => {
            let mut new_dict = lopdf::Dictionary::new();
            for (key, value) in dict.iter() {
                let cloned_value = clone_object_recursive(dest, source, value, visited)?;
                new_dict.set(key.clone(), cloned_value);
            }
            Ok(Object::Dictionary(new_dict))
        }
        Object::Array(arr) => {
            let mut new_arr = Vec::with_capacity(arr.len());
            for item in arr {
                new_arr.push(clone_object_recursive(dest, source, item, visited)?);
            }
            Ok(Object::Array(new_arr))
        }
        Object::Stream(stream) => {
            let mut new_dict = lopdf::Dictionary::new();
            for (key, value) in stream.dict.iter() {
                let cloned_value = clone_object_recursive(dest, source, value, visited)?;
                new_dict.set(key.clone(), cloned_value);
            }
            let new_stream = Stream::new(new_dict, stream.content.clone());
            Ok(Object::Stream(new_stream))
        }
        // Primitive types: clone directly
        other => Ok(other.clone()),
    }
}

pub fn merge_to_pdf(
    items: Vec<PdfBuilderItem>,
    options: MergePdfOptions,
    app_handle: &tauri::AppHandle,
) -> MergePdfResult {
    let mut result = MergePdfResult {
        output_path: options.output_path.clone(),
        page_count: 0,
        errors: Vec::new(),
    };

    let mut doc = LopdfDocument::with_version("1.7");
    let pages_id = doc.new_object_id();
    let mut page_ids: Vec<Object> = Vec::new();

    // Cache: load each source PDF only once, share visited map per source
    // so shared resources (fonts, images) are cloned only once per source file.
    let mut pdf_cache: HashMap<String, LopdfDocument> = HashMap::new();
    let mut visited_cache: HashMap<String, HashMap<lopdf::ObjectId, lopdf::ObjectId>> =
        HashMap::new();

    // Pre-load all unique PDF source files
    for item in &items {
        if item.source_type == "pdf" && !pdf_cache.contains_key(&item.source_path) {
            match LopdfDocument::load(&item.source_path) {
                Ok(source_doc) => {
                    pdf_cache.insert(item.source_path.clone(), source_doc);
                    visited_cache.insert(item.source_path.clone(), HashMap::new());
                }
                Err(e) => {
                    result.errors.push(format!(
                        "{}: Cannot load PDF: {}",
                        filename_or_default(&item.source_path),
                        e
                    ));
                }
            }
        }
    }

    let total_items = items.len();

    for (idx, item) in items.iter().enumerate() {
        match item.source_type.as_str() {
            "image" => match add_image_page(&mut doc, pages_id, &item.source_path, &options) {
                Ok(page_id) => {
                    page_ids.push(Object::Reference(page_id));
                    result.page_count += 1;
                }
                Err(e) => {
                    result.errors.push(format!(
                        "{}: {}",
                        filename_or_default(&item.source_path),
                        e
                    ));
                }
            },
            "pdf" => {
                let page_num = item.page_number.unwrap_or(1);
                if let Some(source_doc) = pdf_cache.get(&item.source_path) {
                    let visited = match visited_cache.get_mut(&item.source_path) {
                        Some(v) => v,
                        None => {
                            result.errors.push(format!(
                                "{}: visited cache missing",
                                filename_or_default(&item.source_path)
                            ));
                            continue;
                        }
                    };
                    match copy_pdf_page_from_loaded(
                        &mut doc,
                        pages_id,
                        source_doc,
                        &item.source_path,
                        page_num,
                        visited,
                    ) {
                        Ok(page_id) => {
                            page_ids.push(Object::Reference(page_id));
                            result.page_count += 1;
                        }
                        Err(e) => {
                            result.errors.push(format!(
                                "{} (page {}): {}",
                                filename_or_default(&item.source_path),
                                page_num,
                                e
                            ));
                        }
                    }
                }
                // If not in cache, the load error was already recorded above
            }
            other => {
                result
                    .errors
                    .push(format!("Unknown source type: {}", other));
            }
        }
        emit_progress_simple(app_handle, idx + 1, total_items, &item.source_path);
    }

    if result.page_count == 0 {
        result
            .errors
            .push("No pages could be added to the PDF".to_string());
        return result;
    }

    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => page_ids,
        "Count" => result.page_count as i64
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id
    });
    doc.trailer.set("Root", Object::Reference(catalog_id));

    if let Some(parent) = Path::new(&options.output_path).parent() {
        if let Err(e) = ensure_output_dir(parent) {
            result.errors.push(e);
            return result;
        }
    }

    if let Err(e) = doc.save(&options.output_path) {
        result.errors.push(format!("Cannot save PDF: {}", e));
        result.page_count = 0;
    }

    result
}
