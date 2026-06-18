use image::codecs::jpeg::JpegEncoder;
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document as LopdfDocument, Object, Stream};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;

use crate::progress::emit_progress_simple;
use crate::utils::{ensure_output_dir, file_stem};

/// Point margin from page edges for watermark placement.
const WATERMARK_MARGIN_PT: f32 = 20.0;
/// Point spacing between tiles in tiled watermark mode.
const WATERMARK_TILE_SPACING_PT: f32 = 80.0;

/// Parse a hex color string into (r, g, b) floats in 0.0–1.0 via the shared parser.
/// Falls back to light grey (179, 179, 179) ≈ (0.7, 0.7, 0.7) on invalid input.
fn hex_to_rgb_f32(hex: &str) -> (f32, f32, f32) {
    let (r, g, b) = crate::utils::parse_hex_color(hex, (179, 179, 179));
    (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PdfWatermarkResult {
    pub output_path: String,
    pub page_count: usize,
    pub errors: Vec<String>,
}

/// Watermark every page of a PDF with a semi-transparent text string.
/// Uses the built-in PDF font Helvetica-Bold (no system font needed).
#[allow(clippy::too_many_arguments)]
pub fn watermark_pdf_text(
    pdf_path: &str,
    text: &str,
    position: &str,
    opacity: f32,
    font_size: f32,
    color: &str,
    output_dir: &str,
    app_handle: &tauri::AppHandle,
) -> PdfWatermarkResult {
    let mut result = PdfWatermarkResult {
        output_path: String::new(),
        page_count: 0,
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    let mut doc = match LopdfDocument::load(pdf_path) {
        Ok(d) => d,
        Err(e) => {
            result.errors.push(format!("Cannot load PDF: {}", e));
            return result;
        }
    };

    let opacity_clamped = opacity.clamp(0.0, 1.0);

    // Create a shared ExtGState for transparency
    let gs_dict = dictionary! {
        "Type" => "ExtGState",
        "ca" => opacity_clamped as f64,
        "CA" => opacity_clamped as f64
    };
    let gs_id = doc.add_object(Object::Dictionary(gs_dict));

    // Create a shared font reference (Helvetica-Bold, built-in PDF font)
    let font_dict = dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica-Bold"
    };
    let font_id = doc.add_object(Object::Dictionary(font_dict));

    // Collect page IDs first to avoid borrow issues
    let page_ids: Vec<lopdf::ObjectId> = doc.page_iter().collect();

    let total_pages = page_ids.len();

    // Pre-create q/Q wrapper streams to isolate existing page CTM from watermark
    let q_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"q\n".to_vec())));
    let big_q_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"Q\n".to_vec())));

    for (idx, &page_id) in page_ids.iter().enumerate() {
        // Read page dimensions from MediaBox
        let (page_w, page_h) = get_page_dimensions(&doc, page_id);

        // Approximate text width (Helvetica-Bold is roughly 0.6 × font_size per char)
        let char_width_factor = 0.6;
        let text_width = font_size * text.len() as f32 * char_width_factor;
        let text_height = font_size;

        // Build the content stream operations for the watermark
        let (cr, cg, cb) = hex_to_rgb_f32(color);
        let operations = build_text_watermark_ops(
            text,
            position,
            font_size,
            text_width,
            text_height,
            page_w,
            page_h,
            cr,
            cg,
            cb,
        );

        let content_ops = Content { operations };
        let content_bytes = match content_ops.encode() {
            Ok(b) => b,
            Err(e) => {
                result
                    .errors
                    .push(format!("Content encode error on page: {}", e));
                continue;
            }
        };

        let content_stream = Stream::new(dictionary! {}, content_bytes);
        let content_id = doc.add_object(Object::Stream(content_stream));

        // Inject watermark resources into the page (handles indirect refs)
        let entries = vec![("ExtGState", "WmGs", gs_id), ("Font", "WmF1", font_id)];
        inject_page_resources(&mut doc, page_id, &entries);

        // Append watermark content stream (wrap existing content in q/Q)
        if let Ok(&mut Object::Dictionary(ref mut page_dict)) = doc.get_object_mut(page_id) {
            append_content_to_page(page_dict, q_id, big_q_id, content_id);
            result.page_count += 1;
        }
        emit_progress_simple(app_handle, idx + 1, total_pages, pdf_path);
    }

    let pdf_stem = file_stem(pdf_path);
    let output_path = out_dir.join(format!("{}-watermarked.pdf", pdf_stem));

    match doc.save(&output_path) {
        Ok(_) => {
            result.output_path = output_path.to_string_lossy().to_string();
        }
        Err(e) => {
            result
                .errors
                .push(format!("Cannot save watermarked PDF: {}", e));
            result.page_count = 0;
        }
    }

    result
}

/// Watermark every page of a PDF with a semi-transparent image/logo overlay.
#[allow(clippy::too_many_arguments)]
pub fn watermark_pdf_image(
    pdf_path: &str,
    image_path: &str,
    position: &str,
    opacity: f32,
    scale: f32,
    output_dir: &str,
    app_handle: &tauri::AppHandle,
) -> PdfWatermarkResult {
    let mut result = PdfWatermarkResult {
        output_path: String::new(),
        page_count: 0,
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    let mut doc = match LopdfDocument::load(pdf_path) {
        Ok(d) => d,
        Err(e) => {
            result.errors.push(format!("Cannot load PDF: {}", e));
            return result;
        }
    };

    // Load the watermark image (keep alpha channel for transparency)
    let img_rgba = match image::open(image_path) {
        Ok(i) => i.into_rgba8(),
        Err(e) => {
            result.errors.push(format!(
                "Cannot load watermark image '{}': {}",
                image_path, e
            ));
            return result;
        }
    };
    let (img_w, img_h) = (img_rgba.width(), img_rgba.height());
    if img_w == 0 || img_h == 0 {
        result
            .errors
            .push("Watermark image has zero dimensions".to_string());
        return result;
    }

    // Separate RGB and Alpha channels
    let mut rgb_pixels: Vec<u8> = Vec::with_capacity((img_w * img_h * 3) as usize);
    let mut alpha_pixels: Vec<u8> = Vec::with_capacity((img_w * img_h) as usize);
    let mut has_transparency = false;
    for pixel in img_rgba.pixels() {
        rgb_pixels.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]);
        alpha_pixels.push(pixel[3]);
        if pixel[3] < 255 {
            has_transparency = true;
        }
    }

    // JPEG-encode the RGB data
    let rgb_image: image::RgbImage = match image::RgbImage::from_raw(img_w, img_h, rgb_pixels) {
        Some(img) => img,
        None => {
            result
                .errors
                .push("Failed to construct RGB image from watermark pixels".to_string());
            return result;
        }
    };
    let mut jpeg_buf: Vec<u8> = Vec::new();
    let mut cursor = Cursor::new(&mut jpeg_buf);
    let encoder = JpegEncoder::new_with_quality(&mut cursor, 90);
    if let Err(e) = rgb_image.write_with_encoder(encoder) {
        result
            .errors
            .push(format!("Cannot encode watermark image: {}", e));
        return result;
    }

    let opacity_clamped = opacity.clamp(0.0, 1.0);

    // Create shared ExtGState for transparency
    let gs_dict = dictionary! {
        "Type" => "ExtGState",
        "ca" => opacity_clamped as f64,
        "CA" => opacity_clamped as f64
    };
    let gs_id = doc.add_object(Object::Dictionary(gs_dict));

    // If the image has transparency, create an SMask (soft mask) XObject
    let smask_obj_id = if has_transparency {
        let mut smask_stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => img_w as i64,
                "Height" => img_h as i64,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8_i64
            },
            alpha_pixels,
        );
        smask_stream.allows_compression = true;
        Some(doc.add_object(Object::Stream(smask_stream)))
    } else {
        None
    };

    // Create the image XObject (disable compression — data is already JPEG-encoded)
    let mut image_dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => img_w as i64,
        "Height" => img_h as i64,
        "ColorSpace" => "DeviceRGB",
        "BitsPerComponent" => 8_i64,
        "Filter" => "DCTDecode"
    };
    if let Some(smask_id) = smask_obj_id {
        image_dict.set("SMask", Object::Reference(smask_id));
    }
    let mut image_stream = Stream::new(image_dict, jpeg_buf);
    image_stream.allows_compression = false;
    let image_obj_id = doc.add_object(Object::Stream(image_stream));

    let scale_clamped = scale.clamp(0.01, 1.0);
    let aspect_ratio = img_h as f32 / img_w as f32;

    // Collect page IDs
    let page_ids: Vec<lopdf::ObjectId> = doc.page_iter().collect();

    let total_pages = page_ids.len();

    // Pre-create q/Q wrapper streams to isolate existing page CTM from watermark
    let q_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"q\n".to_vec())));
    let big_q_id = doc.add_object(Object::Stream(Stream::new(dictionary! {}, b"Q\n".to_vec())));

    for (idx, &page_id) in page_ids.iter().enumerate() {
        let (page_w, page_h) = get_page_dimensions(&doc, page_id);

        // Compute watermark draw dimensions
        let draw_w = page_w * scale_clamped;
        let draw_h = draw_w * aspect_ratio;
        let margin = WATERMARK_MARGIN_PT;

        let operations =
            build_image_watermark_ops(position, draw_w, draw_h, page_w, page_h, margin);

        let content_ops = Content { operations };
        let content_bytes = match content_ops.encode() {
            Ok(b) => b,
            Err(e) => {
                result
                    .errors
                    .push(format!("Content encode error on page: {}", e));
                continue;
            }
        };

        let content_stream = Stream::new(dictionary! {}, content_bytes);
        let content_id = doc.add_object(Object::Stream(content_stream));

        // Inject watermark resources into the page (handles indirect refs)
        let entries = vec![
            ("ExtGState", "WmGs", gs_id),
            ("XObject", "WmImg", image_obj_id),
        ];
        inject_page_resources(&mut doc, page_id, &entries);

        // Append watermark content stream (wrap existing content in q/Q)
        if let Ok(&mut Object::Dictionary(ref mut page_dict)) = doc.get_object_mut(page_id) {
            append_content_to_page(page_dict, q_id, big_q_id, content_id);
            result.page_count += 1;
        }
        emit_progress_simple(app_handle, idx + 1, total_pages, pdf_path);
    }

    let pdf_stem = file_stem(pdf_path);
    let output_path = out_dir.join(format!("{}-watermarked.pdf", pdf_stem));

    match doc.save(&output_path) {
        Ok(_) => {
            result.output_path = output_path.to_string_lossy().to_string();
        }
        Err(e) => {
            result
                .errors
                .push(format!("Cannot save watermarked PDF: {}", e));
            result.page_count = 0;
        }
    }

    result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Read page MediaBox dimensions, defaulting to A4 (595×842) if missing.
fn get_page_dimensions(doc: &LopdfDocument, page_id: lopdf::ObjectId) -> (f32, f32) {
    let default = (595.0_f32, 842.0_f32);
    let page_obj = match doc.get_object(page_id) {
        Ok(o) => o,
        Err(_) => return default,
    };
    let dict = match page_obj {
        Object::Dictionary(d) => d,
        _ => return default,
    };
    let media_box = match dict.get(b"MediaBox") {
        Ok(Object::Array(arr)) => arr,
        _ => return default,
    };
    if media_box.len() < 4 {
        return default;
    }
    let w = obj_to_f32(&media_box[2]).unwrap_or(default.0);
    let h = obj_to_f32(&media_box[3]).unwrap_or(default.1);
    (w, h)
}

fn obj_to_f32(obj: &Object) -> Option<f32> {
    match obj {
        Object::Integer(i) => Some(*i as f32),
        Object::Real(f) => Some(*f),
        _ => None,
    }
}

/// Inject resource entries into a page's Resources dictionary.
/// Properly handles indirect (Reference) Resources AND indirect sub-category dicts
/// (e.g. Font, ExtGState, XObject that are stored as references).
fn inject_page_resources(
    doc: &mut LopdfDocument,
    page_id: lopdf::ObjectId,
    entries: &[(&str, &str, lopdf::ObjectId)],
) {
    // Step 1 (read-only): Determine if Resources is an indirect reference
    let resources_ref_id: Option<lopdf::ObjectId> = doc.get_object(page_id).ok().and_then(|obj| {
        if let Object::Dictionary(d) = obj {
            if let Ok(Object::Reference(ref_id)) = d.get(b"Resources") {
                return Some(*ref_id);
            }
        }
        None
    });

    // Step 2 (read-only): For each entry, check if the sub-category dict (Font, XObject…)
    // is itself an indirect reference inside the Resources dict.
    let sub_category_refs: Vec<Option<lopdf::ObjectId>> = {
        let res_dict_opt: Option<&lopdf::Dictionary> = if let Some(rid) = resources_ref_id {
            match doc.get_object(rid) {
                Ok(Object::Dictionary(d)) => Some(d),
                _ => None,
            }
        } else {
            match doc.get_object(page_id) {
                Ok(Object::Dictionary(page_d)) => match page_d.get(b"Resources") {
                    Ok(Object::Dictionary(d)) => Some(d),
                    _ => None,
                },
                _ => None,
            }
        };

        entries
            .iter()
            .map(|&(category, _, _)| {
                res_dict_opt.and_then(|d| {
                    if let Ok(Object::Reference(ref_id)) = d.get(category.as_bytes()) {
                        Some(*ref_id)
                    } else {
                        None
                    }
                })
            })
            .collect()
    };

    // Step 3 (mutable): For entries whose sub-category IS an indirect ref, modify the ref'd dict
    for (i, &(_, name, obj_id)) in entries.iter().enumerate() {
        if let Some(sub_id) = sub_category_refs[i] {
            if let Ok(&mut Object::Dictionary(ref mut sub_dict)) = doc.get_object_mut(sub_id) {
                sub_dict.set(name, Object::Reference(obj_id));
            }
        }
    }

    // Step 4 (mutable): For entries whose sub-category is inline or missing, handle normally
    let remaining_entries: Vec<(&str, &str, lopdf::ObjectId)> = entries
        .iter()
        .enumerate()
        .filter(|(i, _)| sub_category_refs[*i].is_none())
        .map(|(_, e)| *e)
        .collect();

    if remaining_entries.is_empty() {
        return;
    }

    if let Some(res_id) = resources_ref_id {
        if let Ok(&mut Object::Dictionary(ref mut res_dict)) = doc.get_object_mut(res_id) {
            add_entries_to_resources(res_dict, &remaining_entries);
        }
    } else if let Ok(&mut Object::Dictionary(ref mut page_dict)) = doc.get_object_mut(page_id) {
        if let Ok(Object::Dictionary(ref mut res_dict)) = page_dict.get_mut(b"Resources") {
            add_entries_to_resources(res_dict, &remaining_entries);
        } else {
            let mut new_res = lopdf::Dictionary::new();
            add_entries_to_resources(&mut new_res, &remaining_entries);
            page_dict.set("Resources", Object::Dictionary(new_res));
        }
    }
}

/// Add resource entries (category/name/object_id) to a Resources dictionary,
/// merging into existing inline sub-dictionaries when present.
/// NOTE: Only called for sub-categories that are NOT indirect references
/// (those are handled directly in inject_page_resources).
fn add_entries_to_resources(
    res_dict: &mut lopdf::Dictionary,
    entries: &[(&str, &str, lopdf::ObjectId)],
) {
    for &(category, name, obj_id) in entries {
        if let Ok(Object::Dictionary(ref mut sub)) = res_dict.get_mut(category.as_bytes()) {
            sub.set(name, Object::Reference(obj_id));
        } else {
            res_dict.set(category, Object::Dictionary(dictionary! { name => obj_id }));
        }
    }
}

/// Append a watermark content stream to a page's Contents entry.
/// Wraps the existing page content in q/Q (using pre-created stream objects)
/// to isolate its graphics state, preventing the page's CTM from affecting
/// the watermark rendering.
fn append_content_to_page(
    page_dict: &mut lopdf::Dictionary,
    q_id: lopdf::ObjectId,
    big_q_id: lopdf::ObjectId,
    new_content_id: lopdf::ObjectId,
) {
    match page_dict.get(b"Contents") {
        Ok(Object::Reference(existing_id)) => {
            let existing_id = *existing_id;
            // q  [existing]  Q  [watermark]
            page_dict.set(
                "Contents",
                Object::Array(vec![
                    Object::Reference(q_id),
                    Object::Reference(existing_id),
                    Object::Reference(big_q_id),
                    Object::Reference(new_content_id),
                ]),
            );
        }
        Ok(Object::Array(existing_arr)) => {
            // q  [existing...]  Q  [watermark]
            let mut new_arr = Vec::with_capacity(existing_arr.len() + 3);
            new_arr.push(Object::Reference(q_id));
            new_arr.extend(existing_arr.clone());
            new_arr.push(Object::Reference(big_q_id));
            new_arr.push(Object::Reference(new_content_id));
            page_dict.set("Contents", Object::Array(new_arr));
        }
        _ => {
            page_dict.set("Contents", Object::Reference(new_content_id));
        }
    }
}

/// Build PDF content stream operations for a text watermark at the given position.
#[allow(clippy::too_many_arguments)]
fn build_text_watermark_ops(
    text: &str,
    position: &str,
    font_size: f32,
    text_width: f32,
    text_height: f32,
    page_w: f32,
    page_h: f32,
    color_r: f32,
    color_g: f32,
    color_b: f32,
) -> Vec<Operation> {
    let margin = WATERMARK_MARGIN_PT;

    // For diagonal mode: rotate 45° across the page center
    if position == "diagonal" {
        let cx = page_w / 2.0;
        let cy = page_h / 2.0;
        let angle: f32 = std::f32::consts::FRAC_PI_4; // 45 degrees
        let cos_a = angle.cos();
        let sin_a = angle.sin();
        // Translate so text is centered at page center
        let tx = cx - (text_width * cos_a - text_height * sin_a) / 2.0;
        let ty = cy - (text_width * sin_a + text_height * cos_a) / 2.0;

        return vec![
            Operation::new("q", vec![]),
            Operation::new("gs", vec![Object::Name(b"WmGs".to_vec())]),
            Operation::new("BT", vec![]),
            Operation::new(
                "Tf",
                vec![Object::Name(b"WmF1".to_vec()), Object::Real(font_size)],
            ),
            Operation::new(
                "Tm",
                vec![
                    Object::Real(cos_a),
                    Object::Real(sin_a),
                    Object::Real(-sin_a),
                    Object::Real(cos_a),
                    Object::Real(tx),
                    Object::Real(ty),
                ],
            ),
            Operation::new(
                "rg",
                vec![
                    Object::Real(color_r),
                    Object::Real(color_g),
                    Object::Real(color_b),
                ],
            ),
            Operation::new(
                "Tj",
                vec![Object::String(
                    text.as_bytes().to_vec(),
                    lopdf::StringFormat::Literal,
                )],
            ),
            Operation::new("ET", vec![]),
            Operation::new("Q", vec![]),
        ];
    }

    // For tiled mode: repeat text across the page
    if position == "tiled" {
        let mut ops = vec![
            Operation::new("q", vec![]),
            Operation::new("gs", vec![Object::Name(b"WmGs".to_vec())]),
            Operation::new("BT", vec![]),
            Operation::new(
                "Tf",
                vec![Object::Name(b"WmF1".to_vec()), Object::Real(font_size)],
            ),
            Operation::new(
                "rg",
                vec![
                    Object::Real(color_r),
                    Object::Real(color_g),
                    Object::Real(color_b),
                ],
            ),
        ];

        let step_x = text_width + WATERMARK_TILE_SPACING_PT;
        let step_y = text_height + WATERMARK_TILE_SPACING_PT;
        let mut y = margin;
        while y < page_h {
            let mut x = margin;
            while x < page_w {
                ops.push(Operation::new(
                    "Tm",
                    vec![
                        Object::Real(1.0),
                        Object::Integer(0),
                        Object::Integer(0),
                        Object::Real(1.0),
                        Object::Real(x),
                        Object::Real(y),
                    ],
                ));
                ops.push(Operation::new(
                    "Tj",
                    vec![Object::String(
                        text.as_bytes().to_vec(),
                        lopdf::StringFormat::Literal,
                    )],
                ));
                x += step_x;
            }
            y += step_y;
        }

        ops.push(Operation::new("ET", vec![]));
        ops.push(Operation::new("Q", vec![]));
        return ops;
    }

    // Single-position modes
    let (x, y) = match position {
        "top-left" => (margin, page_h - margin - text_height),
        "top-right" => (page_w - text_width - margin, page_h - margin - text_height),
        "bottom-left" => (margin, margin),
        "bottom-right" => (page_w - text_width - margin, margin),
        // "center" and fallback
        _ => ((page_w - text_width) / 2.0, (page_h - text_height) / 2.0),
    };

    vec![
        Operation::new("q", vec![]),
        Operation::new("gs", vec![Object::Name(b"WmGs".to_vec())]),
        Operation::new("BT", vec![]),
        Operation::new(
            "Tf",
            vec![Object::Name(b"WmF1".to_vec()), Object::Real(font_size)],
        ),
        Operation::new(
            "rg",
            vec![
                Object::Real(color_r),
                Object::Real(color_g),
                Object::Real(color_b),
            ],
        ),
        Operation::new("Td", vec![Object::Real(x), Object::Real(y)]),
        Operation::new(
            "Tj",
            vec![Object::String(
                text.as_bytes().to_vec(),
                lopdf::StringFormat::Literal,
            )],
        ),
        Operation::new("ET", vec![]),
        Operation::new("Q", vec![]),
    ]
}

/// Build PDF content stream operations for an image watermark at the given position.
fn build_image_watermark_ops(
    position: &str,
    draw_w: f32,
    draw_h: f32,
    page_w: f32,
    page_h: f32,
    margin: f32,
) -> Vec<Operation> {
    if position == "tiled" {
        let step_x = draw_w + 40.0;
        let step_y = draw_h + 40.0;
        let mut ops = vec![
            Operation::new("q", vec![]),
            Operation::new("gs", vec![Object::Name(b"WmGs".to_vec())]),
        ];

        let mut y = margin;
        while y < page_h {
            let mut x = margin;
            while x < page_w {
                ops.push(Operation::new("q", vec![]));
                ops.push(Operation::new(
                    "cm",
                    vec![
                        Object::Real(draw_w),
                        Object::Integer(0),
                        Object::Integer(0),
                        Object::Real(draw_h),
                        Object::Real(x),
                        Object::Real(y),
                    ],
                ));
                ops.push(Operation::new("Do", vec![Object::Name(b"WmImg".to_vec())]));
                ops.push(Operation::new("Q", vec![]));
                x += step_x;
            }
            y += step_y;
        }

        ops.push(Operation::new("Q", vec![]));
        return ops;
    }

    // Single-position modes
    let (x, y) = match position {
        "top-left" => (margin, page_h - margin - draw_h),
        "top-right" => (page_w - draw_w - margin, page_h - margin - draw_h),
        "bottom-left" => (margin, margin),
        "bottom-right" => (page_w - draw_w - margin, margin),
        // "center", "diagonal", and fallback
        _ => ((page_w - draw_w) / 2.0, (page_h - draw_h) / 2.0),
    };

    vec![
        Operation::new("q", vec![]),
        Operation::new("gs", vec![Object::Name(b"WmGs".to_vec())]),
        Operation::new(
            "cm",
            vec![
                Object::Real(draw_w),
                Object::Integer(0),
                Object::Integer(0),
                Object::Real(draw_h),
                Object::Real(x),
                Object::Real(y),
            ],
        ),
        Operation::new("Do", vec![Object::Name(b"WmImg".to_vec())]),
        Operation::new("Q", vec![]),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: extract f32 from an Object::Real / Object::Integer operand.
    fn operand_f32(obj: &Object) -> Option<f32> {
        match obj {
            Object::Real(f) => Some(*f),
            Object::Integer(i) => Some(*i as f32),
            _ => None,
        }
    }

    /// Find the first operation whose operator matches `op`.
    fn find_op<'a>(ops: &'a [Operation], op: &str) -> Option<&'a Operation> {
        ops.iter().find(|o| o.operator == op)
    }

    #[test]
    fn hex_to_rgb_f32_parses_and_falls_back() {
        // Pure white -> all channels 1.0
        let (r, g, b) = hex_to_rgb_f32("#ffffff");
        assert!((r - 1.0).abs() < 1e-6);
        assert!((g - 1.0).abs() < 1e-6);
        assert!((b - 1.0).abs() < 1e-6);

        // Pure red -> (1,0,0)
        let (r, g, b) = hex_to_rgb_f32("ff0000");
        assert!((r - 1.0).abs() < 1e-6);
        assert!(g.abs() < 1e-6);
        assert!(b.abs() < 1e-6);

        // Mid grey 0x808080 -> 128/255
        let (r, _, _) = hex_to_rgb_f32("#808080");
        assert!((r - 128.0 / 255.0).abs() < 1e-6);

        // Invalid input -> light grey fallback (179/255 each)
        let (r, g, b) = hex_to_rgb_f32("not-a-color");
        let expected = 179.0 / 255.0;
        assert!((r - expected).abs() < 1e-6);
        assert!((g - expected).abs() < 1e-6);
        assert!((b - expected).abs() < 1e-6);
    }

    #[test]
    fn obj_to_f32_handles_numeric_and_rejects_others() {
        assert_eq!(obj_to_f32(&Object::Integer(842)), Some(842.0));
        assert_eq!(obj_to_f32(&Object::Real(595.5)), Some(595.5));
        assert_eq!(obj_to_f32(&Object::Null), None);
        assert_eq!(obj_to_f32(&Object::Boolean(true)), None);
        assert_eq!(obj_to_f32(&Object::Name(b"MediaBox".to_vec())), None);
    }

    #[test]
    fn text_watermark_top_left_positions_correctly() {
        let page_w = 595.0_f32;
        let page_h = 842.0_f32;
        let font_size = 24.0_f32;
        let text_height = font_size;
        let text_width = font_size * "WM".len() as f32 * 0.6;

        let ops = build_text_watermark_ops(
            "WM",
            "top-left",
            font_size,
            text_width,
            text_height,
            page_w,
            page_h,
            0.0,
            0.0,
            0.0,
        );

        // Single-position mode emits the full q/gs/BT/Tf/rg/Td/Tj/ET/Q sequence.
        assert_eq!(ops.len(), 9);
        assert_eq!(ops[0].operator, "q");
        assert_eq!(ops.last().unwrap().operator, "Q");
        // Opacity is applied through the shared ext-graphics-state.
        assert!(find_op(&ops, "gs").is_some());

        // The font must be set to the watermark font at the requested size.
        let tf = find_op(&ops, "Tf").expect("Tf op present");
        assert_eq!(tf.operands.len(), 2);
        assert!(matches!(&tf.operands[0], Object::Name(n) if n == b"WmF1"));
        assert_eq!(operand_f32(&tf.operands[1]), Some(font_size));

        // top-left => Td at (margin, page_h - margin - text_height).
        let td = find_op(&ops, "Td").expect("Td op present");
        let x = operand_f32(&td.operands[0]).unwrap();
        let y = operand_f32(&td.operands[1]).unwrap();
        assert!((x - WATERMARK_MARGIN_PT).abs() < 1e-4);
        assert!((y - (page_h - WATERMARK_MARGIN_PT - text_height)).abs() < 1e-4);

        // The drawn string is the input text.
        let tj = find_op(&ops, "Tj").expect("Tj op present");
        assert!(matches!(&tj.operands[0], Object::String(bytes, _) if bytes == b"WM"));
    }

    #[test]
    fn text_watermark_diagonal_uses_rotation_matrix() {
        let page_w = 600.0_f32;
        let page_h = 800.0_f32;
        let font_size = 30.0_f32;
        let text_height = font_size;
        let text_width = 120.0_f32;

        let ops = build_text_watermark_ops(
            "DRAFT",
            "diagonal",
            font_size,
            text_width,
            text_height,
            page_w,
            page_h,
            0.1,
            0.2,
            0.3,
        );

        // Diagonal mode uses a text matrix (Tm), not a plain Td translation.
        assert!(find_op(&ops, "Td").is_none());
        let tm = find_op(&ops, "Tm").expect("Tm op present");
        assert_eq!(tm.operands.len(), 6);

        // 45-degree rotation: a == d == cos(45), b == sin(45), c == -sin(45).
        let cos45 = std::f32::consts::FRAC_PI_4.cos();
        let sin45 = std::f32::consts::FRAC_PI_4.sin();
        let a = operand_f32(&tm.operands[0]).unwrap();
        let b = operand_f32(&tm.operands[1]).unwrap();
        let c = operand_f32(&tm.operands[2]).unwrap();
        let d = operand_f32(&tm.operands[3]).unwrap();
        assert!((a - cos45).abs() < 1e-4);
        assert!((b - sin45).abs() < 1e-4);
        assert!((c + sin45).abs() < 1e-4);
        assert!((d - cos45).abs() < 1e-4);

        // The fill color (rg) reflects the requested RGB.
        let rg = find_op(&ops, "rg").expect("rg op present");
        assert!((operand_f32(&rg.operands[0]).unwrap() - 0.1).abs() < 1e-6);
        assert!((operand_f32(&rg.operands[1]).unwrap() - 0.2).abs() < 1e-6);
        assert!((operand_f32(&rg.operands[2]).unwrap() - 0.3).abs() < 1e-6);
    }

    #[test]
    fn image_watermark_bottom_right_cm_matrix_and_tiling() {
        let page_w = 500.0_f32;
        let page_h = 700.0_f32;
        let draw_w = 100.0_f32;
        let draw_h = 50.0_f32;
        let margin = WATERMARK_MARGIN_PT;

        // Single position emits q, gs, cm, Do, Q — verify the shape via find_op.
        let ops = build_image_watermark_ops("bottom-right", draw_w, draw_h, page_w, page_h, margin);
        assert_eq!(ops[0].operator, "q");
        assert_eq!(ops.last().unwrap().operator, "Q");

        // The cm matrix encodes scale (draw_w, draw_h) and placement (x, y).
        let cm = find_op(&ops, "cm").expect("cm op present");
        assert_eq!(cm.operands.len(), 6);
        assert!((operand_f32(&cm.operands[0]).unwrap() - draw_w).abs() < 1e-4);
        assert!((operand_f32(&cm.operands[3]).unwrap() - draw_h).abs() < 1e-4);
        // bottom-right => x = page_w - draw_w - margin, y = margin.
        let x = operand_f32(&cm.operands[4]).unwrap();
        let y = operand_f32(&cm.operands[5]).unwrap();
        assert!((x - (page_w - draw_w - margin)).abs() < 1e-4);
        assert!((y - margin).abs() < 1e-4);

        // The image XObject is invoked exactly once via Do.
        let do_count = ops.iter().filter(|o| o.operator == "Do").count();
        assert_eq!(do_count, 1);

        // Tiled mode invokes Do multiple times (a grid of placements).
        let tiled = build_image_watermark_ops("tiled", draw_w, draw_h, page_w, page_h, margin);
        let tiled_do = tiled.iter().filter(|o| o.operator == "Do").count();
        assert!(tiled_do > 1, "tiled mode should place more than one image");
    }
}
