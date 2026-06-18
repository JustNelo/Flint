use image::codecs::jpeg::JpegEncoder;
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document as LopdfDocument, Object, Stream};
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::Path;

/// Create the output directory if it does not exist.
pub fn ensure_output_dir(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| format!("Cannot create output directory: {}", e))?;
    }
    Ok(())
}

/// Extract the filename from a path, falling back to the full path string.
pub fn filename_or_default(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(path)
}

/// Get the file size in bytes, returning 0 on error.
pub fn file_size(path: &str) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Get the file stem (name without extension), falling back to "output".
pub fn file_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output")
        .to_string()
}

/// Get the lowercase file extension, defaulting to "png".
pub fn get_extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_else(|| "png".to_string())
}

/// Embed an image file as a single PDF page with JPEG encoding.
/// Returns the ObjectId of the created page.
pub fn embed_image_as_pdf_page(
    doc: &mut LopdfDocument,
    pages_id: lopdf::ObjectId,
    image_path: &str,
    page_w: f32,
    page_h: f32,
    margin: f32,
    jpeg_quality: u8,
) -> Result<lopdf::ObjectId, String> {
    let img = image::open(image_path)
        .map_err(|e| format!("Cannot open image '{}': {}", image_path, e))?
        .into_rgb8();

    let (img_w, img_h) = (img.width(), img.height());

    let mut jpeg_buf: Vec<u8> = Vec::new();
    let mut cursor = Cursor::new(&mut jpeg_buf);
    let encoder = JpegEncoder::new_with_quality(&mut cursor, jpeg_quality);
    img.write_with_encoder(encoder)
        .map_err(|e| format!("JPEG encode failed: {}", e))?;

    let available_w = page_w - 2.0 * margin;
    let available_h = page_h - 2.0 * margin;

    let scale_x = available_w / img_w as f32;
    let scale_y = available_h / img_h as f32;
    let scale = scale_x.min(scale_y).min(1.0);

    let draw_w = img_w as f32 * scale;
    let draw_h = img_h as f32 * scale;
    let draw_x = margin + (available_w - draw_w) / 2.0;
    let draw_y = margin + (available_h - draw_h) / 2.0;

    let image_stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => img_w as i64,
            "Height" => img_h as i64,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8_i64,
            "Filter" => "DCTDecode"
        },
        jpeg_buf,
    );
    let image_id = doc.add_object(image_stream);

    let content_ops = Content {
        operations: vec![
            Operation::new("q", vec![]),
            Operation::new(
                "cm",
                vec![
                    Object::Real(draw_w),
                    Object::Integer(0),
                    Object::Integer(0),
                    Object::Real(draw_h),
                    Object::Real(draw_x),
                    Object::Real(draw_y),
                ],
            ),
            Operation::new("Do", vec![Object::Name(b"Img0".to_vec())]),
            Operation::new("Q", vec![]),
        ],
    };

    let content_bytes = content_ops
        .encode()
        .map_err(|e| format!("Content encode error: {}", e))?;

    let content_stream = Stream::new(dictionary! {}, content_bytes);
    let content_id = doc.add_object(content_stream);

    let page = dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![
            Object::Integer(0),
            Object::Integer(0),
            Object::Real(page_w),
            Object::Real(page_h),
        ],
        "Resources" => dictionary! {
            "XObject" => dictionary! {
                "Img0" => image_id
            }
        },
        "Contents" => content_id
    };

    Ok(doc.add_object(page))
}

/// Recursively copy an object (and everything it references) from `source` into
/// `dest`, returning the new ObjectId in `dest`. Already-cloned objects are
/// tracked in `visited` to avoid duplicates and break reference cycles. Errors
/// from the source document are propagated so callers don't emit dangling
/// references.
pub fn deep_clone_object(
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

/// Walk an Object tree, remapping every Reference to a newly-cloned id in `dest`.
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

/// Parse a hex color string (#RRGGBB or RRGGBB) into (r, g, b) u8 components.
/// Falls back to the provided default on invalid input.
pub fn parse_hex_color(hex: &str, default: (u8, u8, u8)) -> (u8, u8, u8) {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return default;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(default.0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(default.1);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(default.2);
    (r, g, b)
}

/// Sanitize a user-provided file stem to prevent path traversal via output filenames.
pub fn sanitize_stem(stem: &str) -> Result<String, String> {
    let trimmed = stem.trim();
    if trimmed.is_empty() {
        return Err("Output stem must not be empty".to_string());
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.contains('\0')
    {
        return Err(format!("Invalid output stem: '{}'", stem));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_clone_remaps_references_and_breaks_cycles() {
        let mut src = lopdf::Document::with_version("1.7");
        let child = src.add_object(lopdf::Object::Dictionary(lopdf::Dictionary::new()));
        let mut parent_dict = lopdf::Dictionary::new();
        parent_dict.set("Kid", lopdf::Object::Reference(child));
        let parent = src.add_object(lopdf::Object::Dictionary(parent_dict));
        // Back-reference child -> parent to exercise the cycle breaker.
        if let Ok(lopdf::Object::Dictionary(d)) = src.get_object_mut(child) {
            d.set("Back", lopdf::Object::Reference(parent));
        }

        let mut dest = lopdf::Document::with_version("1.7");
        let mut visited: std::collections::HashMap<lopdf::ObjectId, lopdf::ObjectId> =
            std::collections::HashMap::new();
        let new_parent = deep_clone_object(&mut dest, &src, parent, &mut visited).unwrap();

        assert!(dest.get_object(new_parent).is_ok());
        assert!(visited.contains_key(&parent));
        assert!(visited.contains_key(&child));
    }

    #[test]
    fn file_stem_unix_path() {
        assert_eq!(file_stem("/home/user/photo.jpg"), "photo");
        assert_eq!(file_stem("/home/user/README"), "README");
    }

    #[cfg(windows)]
    #[test]
    fn file_stem_windows_path() {
        assert_eq!(file_stem("C:\\photos\\image.png"), "image");
        assert_eq!(file_stem("C:\\photos\\README"), "README");
    }

    #[test]
    fn file_stem_empty_fallback() {
        assert_eq!(file_stem(""), "output");
    }

    #[test]
    fn get_extension_normal() {
        assert_eq!(get_extension("photo.PNG"), "png");
        assert_eq!(get_extension("image.JpEg"), "jpeg");
    }

    #[test]
    fn get_extension_no_ext_defaults_to_png() {
        assert_eq!(get_extension("noext"), "png");
        assert_eq!(get_extension(""), "png");
    }

    #[test]
    fn filename_or_default_unix_path() {
        assert_eq!(filename_or_default("/a/b/c.pdf"), "c.pdf");
    }

    #[cfg(windows)]
    #[test]
    fn filename_or_default_windows_path() {
        assert_eq!(filename_or_default("C:\\dir\\file.txt"), "file.txt");
    }

    #[test]
    fn filename_or_default_fallback() {
        assert_eq!(filename_or_default(""), "");
    }

    // --- parse_hex_color ---

    #[test]
    fn parse_hex_color_valid() {
        assert_eq!(parse_hex_color("#FF0000", (0, 0, 0)), (255, 0, 0));
        assert_eq!(parse_hex_color("00ff00", (0, 0, 0)), (0, 255, 0));
        assert_eq!(parse_hex_color("#0000FF", (0, 0, 0)), (0, 0, 255));
    }

    #[test]
    fn parse_hex_color_invalid_falls_back() {
        assert_eq!(parse_hex_color("", (10, 20, 30)), (10, 20, 30));
        assert_eq!(parse_hex_color("#FFF", (10, 20, 30)), (10, 20, 30));
        assert_eq!(parse_hex_color("ZZZZZZ", (1, 2, 3)), (1, 2, 3));
    }

    #[test]
    fn parse_hex_color_case_insensitive() {
        assert_eq!(parse_hex_color("#aaBBcc", (0, 0, 0)), (0xAA, 0xBB, 0xCC));
    }

    // --- sanitize_stem ---

    #[test]
    fn sanitize_stem_valid() {
        assert_eq!(sanitize_stem("my_document").unwrap(), "my_document");
        assert_eq!(sanitize_stem("  trimmed  ").unwrap(), "trimmed");
    }

    #[test]
    fn sanitize_stem_rejects_traversal() {
        assert!(sanitize_stem("../../etc/passwd").is_err());
        assert!(sanitize_stem("foo/bar").is_err());
        assert!(sanitize_stem("foo\\bar").is_err());
        assert!(sanitize_stem("foo..bar").is_err());
    }

    #[test]
    fn sanitize_stem_rejects_empty() {
        assert!(sanitize_stem("").is_err());
        assert!(sanitize_stem("   ").is_err());
    }

    #[test]
    fn sanitize_stem_rejects_null_bytes() {
        assert!(sanitize_stem("file\0name").is_err());
    }
}
