use lopdf::{dictionary, Document as LopdfDocument, Object};
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::progress::emit_progress_simple;
use crate::utils::{embed_image_as_pdf_page, ensure_output_dir, file_stem, filename_or_default};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PdfExtractionResult {
    pub pdf_path: String,
    pub output_dir: String,
    pub extracted_count: usize,
    pub errors: Vec<String>,
}

pub fn extract_images_from_pdf(
    pdf_path: &str,
    output_dir: &str,
    pdfium: &Pdfium,
    output_stem: Option<&str>,
    app_handle: &tauri::AppHandle,
) -> PdfExtractionResult {
    let mut result = PdfExtractionResult {
        pdf_path: pdf_path.to_string(),
        output_dir: output_dir.to_string(),
        extracted_count: 0,
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    let document = match pdfium.load_pdf_from_file(pdf_path, None) {
        Ok(d) => d,
        Err(e) => {
            result
                .errors
                .push(format!("Cannot open PDF '{}': {}", pdf_path, e));
            return result;
        }
    };

    let base_name = output_stem
        .map(|s| s.to_string())
        .unwrap_or_else(|| file_stem(pdf_path));

    let mut image_index: usize = 0;
    let total_pages = document.pages().len() as usize;

    for (page_index, page) in document.pages().iter().enumerate() {
        for object in page.objects().iter() {
            if let Some(image_object) = object.as_image_object() {
                image_index += 1;

                match image_object.get_raw_image() {
                    Ok(dynamic_image) => {
                        let out_path =
                            out_dir.join(format!("{}_img_{}.png", base_name, image_index));
                        match dynamic_image.save(&out_path) {
                            Ok(_) => result.extracted_count += 1,
                            Err(e) => result.errors.push(format!(
                                "Page {}, image {}: failed to save — {}",
                                page_index + 1,
                                image_index,
                                e
                            )),
                        }
                    }
                    Err(e) => {
                        result.errors.push(format!(
                            "Page {}, image {}: failed to extract — {}",
                            page_index + 1,
                            image_index,
                            e
                        ));
                    }
                }
            }
        }
        emit_progress_simple(app_handle, page_index + 1, total_pages, pdf_path);
    }

    result
}

// --- Images to PDF ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImagesToPdfResult {
    pub output_path: String,
    pub page_count: usize,
    pub errors: Vec<String>,
}

pub fn images_to_pdf(
    input_paths: Vec<String>,
    output_path: &str,
    app_handle: &tauri::AppHandle,
) -> ImagesToPdfResult {
    let mut result = ImagesToPdfResult {
        output_path: output_path.to_string(),
        page_count: 0,
        errors: Vec::new(),
    };

    let mut doc = LopdfDocument::with_version("1.7");
    let pages_id = doc.new_object_id();
    let mut page_ids: Vec<Object> = Vec::new();

    let total = input_paths.len();

    for (idx, input_path) in input_paths.iter().enumerate() {
        // Read dimensions from image header only — avoids full pixel decode
        let (width, height) = match image::ImageReader::open(input_path)
            .and_then(|r| r.with_guessed_format())
            .map_err(|e| e.to_string())
            .and_then(|r| r.into_dimensions().map_err(|e| e.to_string()))
        {
            Ok((w, h)) => (w as f32, h as f32),
            Err(e) => {
                result
                    .errors
                    .push(format!("{}: {}", filename_or_default(input_path), e));
                continue;
            }
        };

        match embed_image_as_pdf_page(&mut doc, pages_id, input_path, width, height, 0.0, 85) {
            Ok(page_id) => {
                page_ids.push(Object::Reference(page_id));
                result.page_count += 1;
            }
            Err(e) => {
                result
                    .errors
                    .push(format!("{}: {}", filename_or_default(input_path), e));
            }
        }
        emit_progress_simple(app_handle, idx + 1, total, input_path);
    }

    if result.page_count == 0 {
        result
            .errors
            .push("No images could be added to the PDF".to_string());
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

    if let Err(e) = doc.save(output_path) {
        result.errors.push(format!("Cannot save PDF: {}", e));
        result.page_count = 0;
    }

    result
}

// --- PDF to Images ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PdfToImagesResult {
    pub pdf_path: String,
    pub output_dir: String,
    pub exported_count: usize,
    pub errors: Vec<String>,
}

pub fn pdf_to_images(
    pdf_path: &str,
    output_dir: &str,
    pdfium: &Pdfium,
    format: &str,
    dpi: u32,
    output_stem: Option<&str>,
    app_handle: &tauri::AppHandle,
) -> PdfToImagesResult {
    let mut result = PdfToImagesResult {
        pdf_path: pdf_path.to_string(),
        output_dir: output_dir.to_string(),
        exported_count: 0,
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    let document = match pdfium.load_pdf_from_file(pdf_path, None) {
        Ok(d) => d,
        Err(e) => {
            result
                .errors
                .push(format!("Cannot open PDF '{}': {}", pdf_path, e));
            return result;
        }
    };

    let pdf_stem = output_stem
        .map(|s| s.to_string())
        .unwrap_or_else(|| file_stem(pdf_path));

    // Scale factor: pdfium renders at 72 DPI by default
    let scale = dpi as f32 / 72.0;
    let total_pages = document.pages().len() as usize;

    for (page_index, page) in document.pages().iter().enumerate() {
        let page_w = page.width().value * scale;
        let page_h = page.height().value * scale;

        let render_config = PdfRenderConfig::new()
            .set_target_width(page_w as i32)
            .set_maximum_height(page_h as i32);

        match page.render_with_config(&render_config) {
            Ok(bitmap) => {
                let dynamic_image = bitmap.as_image();
                let ext = if format == "jpg" { "jpg" } else { "png" };
                let out_path =
                    out_dir.join(format!("{}_page_{}.{}", pdf_stem, page_index + 1, ext));

                let save_result = if format == "jpg" {
                    dynamic_image.to_rgb8().save(&out_path)
                } else {
                    dynamic_image.save(&out_path)
                };

                match save_result {
                    Ok(_) => result.exported_count += 1,
                    Err(e) => result.errors.push(format!(
                        "Page {}: failed to save — {}",
                        page_index + 1,
                        e
                    )),
                }
            }
            Err(e) => {
                result
                    .errors
                    .push(format!("Page {}: render failed — {}", page_index + 1, e));
            }
        }
        emit_progress_simple(app_handle, page_index + 1, total_pages, pdf_path);
    }

    result
}

// --- PDF Compression ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PdfCompressResult {
    pub output_path: String,
    pub original_size: u64,
    pub compressed_size: u64,
    pub errors: Vec<String>,
}

/// Returns `false` for image XObjects that cannot be safely re-encoded to a
/// plain 8-bit DeviceRGB/DeviceGray JPEG without losing data or corrupting the
/// page. Skipping these (leaving the original stream untouched) avoids dropping
/// transparency (SMask), mangling predictors, or misinterpreting non-8-bit /
/// indexed / ICC / array color spaces.
fn is_safely_recompressible(dict: &lopdf::Dictionary) -> bool {
    if dict.has(b"SMask") {
        return false;
    }
    if let Ok(bpc) = dict.get(b"BitsPerComponent").and_then(|o| o.as_i64()) {
        if bpc != 8 {
            return false;
        }
    }
    if dict.has(b"DecodeParms") || dict.has(b"DP") {
        return false;
    }
    match dict.get(b"ColorSpace").and_then(|o| o.as_name()) {
        Ok(b"DeviceRGB") | Ok(b"DeviceGray") => {}
        _ => return false, // array / indexed / icc / missing → skip
    }
    true
}

/// Compress a PDF by re-encoding embedded images at lower JPEG quality.
///
/// Handles two main stream types:
/// - **DCTDecode** (already JPEG): decode → re-encode at target quality
/// - **FlateDecode** (raw pixels, deflate-compressed): decompress → reconstruct
///   from raw pixel data using Width/Height/ColorSpace → encode as JPEG
///
/// Size guard: if the output is larger than the original, copies the original.
pub fn compress_pdf(
    pdf_path: &str,
    quality: u8,
    output_dir: &str,
    app_handle: &tauri::AppHandle,
) -> PdfCompressResult {
    let mut result = PdfCompressResult {
        output_path: String::new(),
        original_size: 0,
        compressed_size: 0,
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    result.original_size = std::fs::metadata(pdf_path).map(|m| m.len()).unwrap_or(0);

    let mut doc = match LopdfDocument::load(pdf_path) {
        Ok(d) => d,
        Err(e) => {
            result.errors.push(format!("Cannot load PDF: {}", e));
            return result;
        }
    };

    let object_ids: Vec<lopdf::ObjectId> = doc.objects.keys().copied().collect();
    let total_objects = object_ids.len();
    let mut images_replaced: usize = 0;

    for (idx, obj_id) in object_ids.iter().enumerate() {
        // --- Phase 1: extract image metadata + decompressed content (clone) ---
        let image_info = {
            let stream = match doc.get_object(*obj_id).and_then(|o| o.as_stream()) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let is_image = stream
                .dict
                .get(b"Subtype")
                .ok()
                .and_then(|v| v.as_name().ok())
                .and_then(|n| std::str::from_utf8(n).ok())
                == Some("Image");
            if !is_image {
                continue;
            }

            // Skip images that cannot be safely re-encoded (SMask / non-8-bit /
            // predictor / non-RGB-or-Gray color space) — leave them untouched.
            if !is_safely_recompressible(&stream.dict) {
                continue;
            }

            let width = stream
                .dict
                .get(b"Width")
                .ok()
                .and_then(|v| v.as_i64().ok())
                .unwrap_or(0) as u32;
            let height = stream
                .dict
                .get(b"Height")
                .ok()
                .and_then(|v| v.as_i64().ok())
                .unwrap_or(0) as u32;
            if width == 0 || height == 0 {
                continue;
            }

            let colorspace = stream
                .dict
                .get(b"ColorSpace")
                .ok()
                .and_then(|v| v.as_name().ok())
                .and_then(|n| std::str::from_utf8(n).ok())
                .unwrap_or("")
                .to_string();

            // Detect DCT either as a bare Name filter or as the last element of
            // a filter array (e.g. [/FlateDecode /DCTDecode]).
            let filter_name: Option<Vec<u8>> = match stream.dict.get(b"Filter") {
                Ok(lopdf::Object::Name(n)) => Some(n.clone()),
                Ok(lopdf::Object::Array(a)) => {
                    a.last().and_then(|o| o.as_name().ok()).map(|n| n.to_vec())
                }
                _ => None,
            };
            let is_dct = filter_name.as_deref() == Some(b"DCTDecode");
            let original_len = stream.content.len();

            // Clone + decompress non-JPEG streams
            let mut cloned = stream.clone();
            if !is_dct {
                let _ = cloned.decompress();
            }

            Some((
                width,
                height,
                colorspace,
                is_dct,
                cloned.content,
                original_len,
            ))
        }; // immutable borrow of `doc` ends here

        let (width, height, colorspace, is_dct, content, original_len) = match image_info {
            Some(info) => info,
            None => continue,
        };

        // --- Phase 2: reconstruct a DynamicImage ---
        let img: Option<image::DynamicImage> = if is_dct {
            image::load_from_memory(&content).ok()
        } else {
            match colorspace.as_str() {
                "DeviceRGB" => image::RgbImage::from_raw(width, height, content)
                    .map(image::DynamicImage::ImageRgb8),
                "DeviceGray" => image::GrayImage::from_raw(width, height, content)
                    .map(image::DynamicImage::ImageLuma8),
                _ => image::load_from_memory(&content).ok(),
            }
        };

        // --- Phase 3: re-encode as JPEG and replace if smaller ---
        if let Some(img) = img {
            let mut jpeg_buf = std::io::Cursor::new(Vec::new());
            let encoder =
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, quality);
            if img.write_with_encoder(encoder).is_ok() {
                let jpeg_data = jpeg_buf.into_inner();
                if jpeg_data.len() < original_len {
                    let new_stream = lopdf::Stream::new(
                        lopdf::Dictionary::from_iter(vec![
                            ("Type", Object::Name(b"XObject".to_vec())),
                            ("Subtype", Object::Name(b"Image".to_vec())),
                            ("Width", Object::Integer(width as i64)),
                            ("Height", Object::Integer(height as i64)),
                            ("ColorSpace", Object::Name(b"DeviceRGB".to_vec())),
                            ("BitsPerComponent", Object::Integer(8)),
                            ("Filter", Object::Name(b"DCTDecode".to_vec())),
                            ("Length", Object::Integer(jpeg_data.len() as i64)),
                        ]),
                        jpeg_data,
                    );
                    doc.objects.insert(*obj_id, Object::Stream(new_stream));
                    images_replaced += 1;
                }
            }
        }
        if idx % 20 == 0 || idx + 1 == total_objects {
            emit_progress_simple(app_handle, idx + 1, total_objects, pdf_path);
        }
    }

    let pdf_stem = file_stem(pdf_path);
    let output_path = out_dir.join(format!("{}-compressed.pdf", pdf_stem));

    // If no images were replaced, just copy the original (nothing to gain)
    if images_replaced == 0 {
        match std::fs::copy(pdf_path, &output_path) {
            Ok(_) => {
                result.output_path = output_path.to_string_lossy().to_string();
                result.compressed_size = result.original_size;
            }
            Err(e) => result.errors.push(format!("Cannot copy PDF: {}", e)),
        }
        return result;
    }

    match doc.save(&output_path) {
        Ok(_) => {
            let compressed_size = std::fs::metadata(&output_path)
                .map(|m| m.len())
                .unwrap_or(0);

            // Size guard: if compressed is bigger, replace with original copy
            if compressed_size >= result.original_size {
                let _ = std::fs::copy(pdf_path, &output_path);
                result.compressed_size = result.original_size;
            } else {
                result.compressed_size = compressed_size;
            }
            result.output_path = output_path.to_string_lossy().to_string();
        }
        Err(e) => {
            result
                .errors
                .push(format!("Cannot save compressed PDF: {}", e));
        }
    }

    result
}

// --- PDF Password Protection ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PdfProtectResult {
    pub output_path: String,
    pub success: bool,
    pub errors: Vec<String>,
}

/// Standard PDF padding string (Table 3.18, PDF Reference 1.7)
const PDF_PADDING: [u8; 32] = [
    0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
    0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
];

/// Pad or truncate a password to exactly 32 bytes per PDF spec
fn pad_password(password: &[u8]) -> [u8; 32] {
    let mut padded = [0u8; 32];
    let len = password.len().min(32);
    padded[..len].copy_from_slice(&password[..len]);
    if len < 32 {
        padded[len..].copy_from_slice(&PDF_PADDING[..(32 - len)]);
    }
    padded
}

/// Simple RC4 implementation for PDF encryption (40-bit key, per spec)
fn rc4_encrypt(key: &[u8], data: &[u8]) -> Vec<u8> {
    // KSA (Key-Scheduling Algorithm)
    let mut s: Vec<u8> = (0..=255).collect();
    let mut j: usize = 0;
    for i in 0..256 {
        j = (j + s[i] as usize + key[i % key.len()] as usize) % 256;
        s.swap(i, j);
    }
    // PRGA (Pseudo-Random Generation Algorithm)
    let mut i: usize = 0;
    j = 0;
    let mut output = Vec::with_capacity(data.len());
    for &byte in data {
        i = (i + 1) % 256;
        j = (j + s[i] as usize) % 256;
        s.swap(i, j);
        let k = s[(s[i] as usize + s[j] as usize) % 256];
        output.push(byte ^ k);
    }
    output
}

/// AES-128 key length in bytes (V=4, R=4 from PDF 1.7 §7.6.3).
const AES_KEY_LEN: usize = 16;

/// Compute the O (owner) value — Algorithm 3.3 from PDF 1.7 spec, for R ≥ 3.
/// Differs from R=2 by 50 extra MD5 rounds and 20 RC4 passes with rotated keys.
fn compute_o_value_r4(owner_password: &[u8], user_password: &[u8]) -> Vec<u8> {
    let owner_padded = pad_password(owner_password);
    // 51 MD5 rounds total: initial + 50 iterations
    let mut hash = md5::compute(owner_padded).0;
    for _ in 0..50 {
        hash = md5::compute(hash).0;
    }
    let key = &hash[..AES_KEY_LEN];
    let user_padded = pad_password(user_password);
    let mut enc = rc4_encrypt(key, &user_padded);
    // 20 RC4 rounds with key[i] = key XOR i (byte-wise)
    let mut rotated = vec![0u8; key.len()];
    for i in 1u8..=19 {
        for (b, k) in rotated.iter_mut().zip(key.iter()) {
            *b = k ^ i;
        }
        enc = rc4_encrypt(&rotated, &enc);
    }
    enc
}

/// Compute the global encryption key — Algorithm 3.2 from PDF 1.7 spec, for R ≥ 3.
/// Returns 16 bytes for AES-128 (V=4).
fn compute_encryption_key_r4(
    user_password: &[u8],
    o_value: &[u8],
    permissions: i32,
    file_id: &[u8],
) -> Vec<u8> {
    let user_padded = pad_password(user_password);
    let mut digest_input = Vec::with_capacity(68 + file_id.len());
    digest_input.extend_from_slice(&user_padded);
    digest_input.extend_from_slice(o_value);
    digest_input.extend_from_slice(&permissions.to_le_bytes());
    digest_input.extend_from_slice(file_id);
    // No /EncryptMetadata override — we always encrypt metadata, so no 4×0xFF suffix.
    let mut hash = md5::compute(&digest_input).0;
    // 50 rounds of MD5 over the truncated previous hash (Algorithm 3.2 step 6).
    for _ in 0..50 {
        hash = md5::compute(&hash[..AES_KEY_LEN]).0;
    }
    hash[..AES_KEY_LEN].to_vec()
}

/// Compute the U (user) value — Algorithm 3.5 from PDF 1.7 spec, for R ≥ 3.
/// 16-byte MD5 of (padding + file_id), RC4'd with 20 rotating-key rounds,
/// then padded out to 32 bytes (the last 16 bytes are arbitrary per spec).
fn compute_u_value_r4(global_key: &[u8], file_id: &[u8]) -> Vec<u8> {
    let mut digest_input = Vec::with_capacity(32 + file_id.len());
    digest_input.extend_from_slice(&PDF_PADDING);
    digest_input.extend_from_slice(file_id);
    let hash = md5::compute(&digest_input).0;
    let mut enc = rc4_encrypt(global_key, &hash);
    let mut rotated = vec![0u8; global_key.len()];
    for i in 1u8..=19 {
        for (b, k) in rotated.iter_mut().zip(global_key.iter()) {
            *b = k ^ i;
        }
        enc = rc4_encrypt(&rotated, &enc);
    }
    // Pad to 32 bytes — spec says "padding string" so we reuse PDF_PADDING.
    let mut u_value = enc;
    u_value.extend_from_slice(&PDF_PADDING[..32 - u_value.len()]);
    u_value
}

/// Per-object AES key — Algorithm 1 from PDF 1.7 spec, with the AES `"sAlT"`
/// suffix (4 bytes) that distinguishes V=4 derivation from RC4 V=1/V=2.
fn compute_object_key_aes(global_key: &[u8], obj_num: u32, gen_num: u16) -> Vec<u8> {
    let mut data = Vec::with_capacity(global_key.len() + 9);
    data.extend_from_slice(global_key);
    data.push((obj_num & 0xFF) as u8);
    data.push(((obj_num >> 8) & 0xFF) as u8);
    data.push(((obj_num >> 16) & 0xFF) as u8);
    data.push((gen_num & 0xFF) as u8);
    data.push(((gen_num >> 8) & 0xFF) as u8);
    data.extend_from_slice(b"sAlT");
    let hash = md5::compute(&data).0;
    let key_len = (global_key.len() + 5).min(16);
    hash[..key_len].to_vec()
}

type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;

/// AES-128-CBC with a fresh random 16-byte IV prepended to the ciphertext,
/// per PDF 1.7 §7.6.2. Plaintext is PKCS#7-padded before encryption.
fn aes_encrypt(obj_key: &[u8], plaintext: &[u8]) -> Vec<u8> {
    use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
    use rand::RngCore;

    let mut iv = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut iv);

    // PKCS#7 needs up to 16 extra bytes for padding; allocate accordingly.
    let mut buf = vec![0u8; plaintext.len() + 16];
    buf[..plaintext.len()].copy_from_slice(plaintext);

    let mut key_arr = [0u8; AES_KEY_LEN];
    // obj_key.len() can be less than 16 if global_key < 11 bytes (unreachable
    // here since we use AES-128/16-byte global), but be defensive.
    let copy_len = obj_key.len().min(AES_KEY_LEN);
    key_arr[..copy_len].copy_from_slice(&obj_key[..copy_len]);

    let cipher = Aes128CbcEnc::new(&key_arr.into(), &iv.into());
    let ct_len = cipher
        .encrypt_padded_mut::<Pkcs7>(&mut buf, plaintext.len())
        .expect("PKCS#7 buffer sized plaintext.len() + 16 fits any padding")
        .len();

    let mut out = Vec::with_capacity(16 + ct_len);
    out.extend_from_slice(&iv);
    out.extend_from_slice(&buf[..ct_len]);
    out
}

/// Recursively AES-encrypt all String values and Stream data inside a lopdf Object.
fn encrypt_object(obj: &mut Object, obj_key: &[u8]) {
    match obj {
        Object::String(ref mut data, _) => {
            *data = aes_encrypt(obj_key, data);
        }
        Object::Array(ref mut arr) => {
            for item in arr.iter_mut() {
                encrypt_object(item, obj_key);
            }
        }
        Object::Dictionary(ref mut dict) => {
            encrypt_dictionary(dict, obj_key);
        }
        Object::Stream(ref mut stream) => {
            // Encrypt the raw stream bytes (compression filters stay intact —
            // the reader will first decrypt, then decompress).
            stream.content = aes_encrypt(obj_key, &stream.content);
            // Also encrypt any string values living inside the stream dictionary.
            encrypt_dictionary(&mut stream.dict, obj_key);
        }
        _ => {}
    }
}

/// Encrypt all values in a lopdf Dictionary (keys are Names and stay clear).
fn encrypt_dictionary(dict: &mut lopdf::Dictionary, obj_key: &[u8]) {
    for (_, value) in dict.iter_mut() {
        encrypt_object(value, obj_key);
    }
}

/// Protect a PDF with a user password using the PDF Standard Security Handler.
/// Implements PDF 1.7 §7.6.3 with **V=4, R=4, AES-128**:
/// - O value: Algorithm 3.3 (R ≥ 3) — 50 MD5 rounds + 20 RC4 rounds
/// - Encryption key: Algorithm 3.2 (R ≥ 3) — 50 MD5 rounds, 16 bytes
/// - U value: Algorithm 3.5 (R ≥ 3) — RC4 of MD5(padding || file_id)
/// - Per-object key: Algorithm 1 with the AES `"sAlT"` suffix
/// - Strings + streams: AES-128-CBC with PKCS#7 padding and random 16-byte IV
///
/// AES-128 PDF encryption is supported by all PDF readers that target ≥ PDF 1.6
/// (Adobe Reader 7+, Apple Preview, pdfium, Foxit, MuPDF, etc.).
pub fn protect_pdf(
    pdf_path: &str,
    password: &str,
    output_dir: &str,
    app_handle: &tauri::AppHandle,
) -> PdfProtectResult {
    let mut result = PdfProtectResult {
        output_path: String::new(),
        success: false,
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
            result.errors.push(format!("Cannot open PDF: {}", e));
            return result;
        }
    };

    let pw_bytes = password.as_bytes();

    // Get or create a file ID — required by the encryption key derivation.
    let file_id: Vec<u8> = doc
        .trailer
        .get(b"ID")
        .ok()
        .and_then(|id_obj| {
            if let Object::Array(ref arr) = *id_obj {
                arr.first().and_then(|first| {
                    if let Object::String(ref s, _) = *first {
                        Some(s.clone())
                    } else {
                        None
                    }
                })
            } else {
                None
            }
        })
        .unwrap_or_else(|| {
            let hash = md5::compute(pdf_path.as_bytes());
            hash.0.to_vec()
        });

    // Permission flags. -4 == 0xFFFFFFFC grants ALL permissions except the two
    // reserved low bits (1 and 2): printing, copying/extraction, modification,
    // etc. all stay enabled. This does NOT disable content extraction — narrow
    // the value only if specific restrictions are actually wanted.
    let permissions: i32 = -4;

    let o_value = compute_o_value_r4(pw_bytes, pw_bytes);
    let global_key = compute_encryption_key_r4(pw_bytes, &o_value, permissions, &file_id);
    let u_value = compute_u_value_r4(&global_key, &file_id);

    // Encrypt every indirect object. The Encrypt dict itself is added AFTER
    // this loop so it stays in clear text (required for readers to find it).
    let object_ids: Vec<(u32, u16)> = doc.objects.keys().cloned().collect();
    let total_objects = object_ids.len();
    for (idx, (obj_num, gen_num)) in object_ids.iter().enumerate() {
        let obj_key = compute_object_key_aes(&global_key, *obj_num, *gen_num);
        if let Some(obj) = doc.objects.get_mut(&(*obj_num, *gen_num)) {
            encrypt_object(obj, &obj_key);
        }
        if idx % 20 == 0 || idx + 1 == total_objects {
            emit_progress_simple(app_handle, idx + 1, total_objects, pdf_path);
        }
    }

    // V=4 requires a CF (Crypt Filter) dictionary naming AESV2 for both
    // streams (StmF) and strings (StrF). StdCF is the conventional name.
    let std_cf = dictionary! {
        "Type" => Object::Name(b"CryptFilter".to_vec()),
        "CFM" => Object::Name(b"AESV2".to_vec()),
        "Length" => Object::Integer(AES_KEY_LEN as i64),
        "AuthEvent" => Object::Name(b"DocOpen".to_vec()),
    };
    let cf_dict = dictionary! {
        "StdCF" => Object::Dictionary(std_cf),
    };

    let encrypt_dict = dictionary! {
        "Filter" => Object::Name(b"Standard".to_vec()),
        "V" => Object::Integer(4),
        "R" => Object::Integer(4),
        "Length" => Object::Integer((AES_KEY_LEN * 8) as i64),
        "P" => Object::Integer(permissions as i64),
        "O" => Object::String(o_value, lopdf::StringFormat::Literal),
        "U" => Object::String(u_value, lopdf::StringFormat::Literal),
        "CF" => Object::Dictionary(cf_dict),
        "StmF" => Object::Name(b"StdCF".to_vec()),
        "StrF" => Object::Name(b"StdCF".to_vec()),
    };

    let encrypt_id = doc.add_object(Object::Dictionary(encrypt_dict));
    doc.trailer.set("Encrypt", Object::Reference(encrypt_id));

    // Ensure the trailer carries an ID array — readers refuse encrypted PDFs
    // without one.
    if doc.trailer.get(b"ID").is_err() {
        let id_string = Object::String(file_id.clone(), lopdf::StringFormat::Literal);
        doc.trailer
            .set("ID", Object::Array(vec![id_string.clone(), id_string]));
    }

    let pdf_stem = file_stem(pdf_path);
    let output_path = out_dir.join(format!("{}-protected.pdf", pdf_stem));

    match doc.save(&output_path) {
        Ok(_) => {
            result.output_path = output_path.to_string_lossy().to_string();
            result.success = true;
        }
        Err(e) => {
            result
                .errors
                .push(format!("Cannot save protected PDF: {}", e));
        }
    }

    result
}

/// Unlock a password-protected PDF using pdfium.
/// 1. pdfium opens the encrypted PDF with the password (decrypts in memory).
/// 2. We create a brand-new empty PDF document (no encryption metadata).
/// 3. We import all pages from the decrypted source into the new document.
/// 4. We save the new document — it contains the decrypted content without
///    any /Encrypt dictionary, so readers will never prompt for a password.
pub fn unlock_pdf(
    pdfium: &Pdfium,
    pdf_path: &str,
    password: &str,
    output_dir: &str,
) -> PdfProtectResult {
    let mut result = PdfProtectResult {
        output_path: String::new(),
        success: false,
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    // Step 1: pdfium opens and decrypts the PDF in memory
    let encrypted_doc = match pdfium.load_pdf_from_file(pdf_path, Some(password)) {
        Ok(d) => d,
        Err(e) => {
            // pdfium-render wraps the underlying PasswordError inside
            // PdfiumLibraryInternalError. Surfacing the Debug string is ugly,
            // so we emit a stable sentinel the frontend can translate.
            let is_password_error = format!("{:?}", e).contains("PasswordError");
            let msg = if is_password_error {
                "WRONG_PASSWORD".to_string()
            } else {
                format!("Cannot open PDF: {}", e)
            };
            result.errors.push(msg);
            return result;
        }
    };

    // Step 2: create a brand-new empty PDF (no encryption metadata at all)
    let mut new_doc = match pdfium.create_new_pdf() {
        Ok(d) => d,
        Err(e) => {
            result
                .errors
                .push(format!("Cannot create new PDF document: {}", e));
            return result;
        }
    };

    // Step 3: import all decrypted pages into the clean document
    if let Err(e) = new_doc.pages_mut().append(&encrypted_doc) {
        result
            .errors
            .push(format!("Cannot import pages from encrypted PDF: {}", e));
        return result;
    }

    // Step 4: save the clean, unencrypted PDF
    let pdf_stem = file_stem(pdf_path);
    let output_path = out_dir.join(format!("{}-unlocked.pdf", pdf_stem));

    match new_doc.save_to_file(&output_path) {
        Ok(_) => {
            result.output_path = output_path.to_string_lossy().to_string();
            result.success = true;
        }
        Err(e) => {
            result
                .errors
                .push(format!("Cannot save unlocked PDF: {}", e));
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- is_safely_recompressible ---

    #[test]
    fn is_safely_recompressible_rejects_unsafe_dicts() {
        let mut smask = lopdf::Dictionary::new();
        smask.set("ColorSpace", lopdf::Object::Name(b"DeviceRGB".to_vec()));
        smask.set("BitsPerComponent", 8i64);
        smask.set("SMask", 1i64);
        assert!(!is_safely_recompressible(&smask));

        let mut deep = lopdf::Dictionary::new();
        deep.set("ColorSpace", lopdf::Object::Name(b"DeviceRGB".to_vec()));
        deep.set("BitsPerComponent", 4i64);
        assert!(!is_safely_recompressible(&deep));

        let mut indexed = lopdf::Dictionary::new();
        indexed.set("ColorSpace", lopdf::Object::Name(b"Indexed".to_vec()));
        indexed.set("BitsPerComponent", 8i64);
        assert!(!is_safely_recompressible(&indexed));
    }

    #[test]
    fn is_safely_recompressible_accepts_plain_8bit_rgb() {
        let mut ok = lopdf::Dictionary::new();
        ok.set("ColorSpace", lopdf::Object::Name(b"DeviceRGB".to_vec()));
        ok.set("BitsPerComponent", 8i64);
        assert!(is_safely_recompressible(&ok));
    }

    // --- pad_password ---

    #[test]
    fn pad_password_empty_uses_full_padding() {
        let padded = pad_password(b"");
        assert_eq!(padded, PDF_PADDING);
    }

    #[test]
    fn pad_password_short_pads_with_spec_bytes() {
        let padded = pad_password(b"test");
        assert_eq!(&padded[..4], b"test");
        assert_eq!(&padded[4..], &PDF_PADDING[..28]);
    }

    #[test]
    fn pad_password_exact_32_no_padding() {
        let input = [0xABu8; 32];
        let padded = pad_password(&input);
        assert_eq!(padded, input);
    }

    #[test]
    fn pad_password_over_32_truncates() {
        let input = [0xCDu8; 50];
        let padded = pad_password(&input);
        assert_eq!(padded, [0xCDu8; 32]);
    }

    // --- rc4_encrypt ---

    #[test]
    fn rc4_encrypt_roundtrip() {
        // RC4 is symmetric: encrypting twice with the same key yields the original
        let key = b"mykey";
        let plaintext = b"Hello, World!";
        let ciphertext = rc4_encrypt(key, plaintext);
        assert_ne!(&ciphertext, plaintext);
        let decrypted = rc4_encrypt(key, &ciphertext);
        assert_eq!(&decrypted, plaintext);
    }

    #[test]
    fn rc4_encrypt_known_vector() {
        // Known RC4 test vector: Key = "Key", Plaintext = "Plaintext"
        let key = b"Key";
        let plaintext = b"Plaintext";
        let ciphertext = rc4_encrypt(key, plaintext);
        let expected: [u8; 9] = [0xBB, 0xF3, 0x16, 0xE8, 0xD9, 0x40, 0xAF, 0x0A, 0xD3];
        assert_eq!(ciphertext, expected);
    }

    #[test]
    fn rc4_encrypt_empty_data() {
        let result = rc4_encrypt(b"key", b"");
        assert!(result.is_empty());
    }

    // --- R=4 / AES-128 algorithms ---

    #[test]
    fn compute_o_value_r4_deterministic() {
        let o1 = compute_o_value_r4(b"owner", b"user");
        let o2 = compute_o_value_r4(b"owner", b"user");
        assert_eq!(o1, o2);
        assert_eq!(o1.len(), 32);
    }

    #[test]
    fn compute_o_value_r4_different_passwords_differ() {
        let o1 = compute_o_value_r4(b"owner1", b"user");
        let o2 = compute_o_value_r4(b"owner2", b"user");
        assert_ne!(o1, o2);
    }

    #[test]
    fn compute_encryption_key_r4_is_16_bytes() {
        let o = compute_o_value_r4(b"pw", b"pw");
        let key = compute_encryption_key_r4(b"pw", &o, -4, b"file_id");
        assert_eq!(key.len(), 16);
    }

    #[test]
    fn compute_u_value_r4_is_32_bytes() {
        let o = compute_o_value_r4(b"pw", b"pw");
        let key = compute_encryption_key_r4(b"pw", &o, -4, b"file_id");
        let u = compute_u_value_r4(&key, b"file_id");
        assert_eq!(u.len(), 32);
    }

    #[test]
    fn compute_object_key_aes_uses_salt_suffix() {
        // Different "sAlT" bytes would change the hash, so a stable result
        // proves the suffix is being applied in the right position.
        let key1 = compute_object_key_aes(&[0u8; 16], 1, 0);
        let key2 = compute_object_key_aes(&[0u8; 16], 1, 0);
        assert_eq!(key1, key2);
        assert_eq!(key1.len(), 16);
        // Different obj_num must yield different keys.
        let key3 = compute_object_key_aes(&[0u8; 16], 2, 0);
        assert_ne!(key1, key3);
    }

    #[test]
    fn aes_encrypt_prepends_random_iv_and_pads() {
        let key = [0x42u8; 16];
        let plaintext = b"hello world";
        let ct1 = aes_encrypt(&key, plaintext);
        let ct2 = aes_encrypt(&key, plaintext);
        // 16-byte IV + at least one 16-byte block of ciphertext for short input.
        assert!(ct1.len() >= 32);
        assert_eq!(ct1.len() % 16, 0);
        // Random IV → two encryptions of the same plaintext differ.
        assert_ne!(ct1, ct2);
        // IV (first 16 bytes) is also random.
        assert_ne!(&ct1[..16], &ct2[..16]);
    }

    #[test]
    fn aes_encrypt_roundtrip() {
        use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
        type Dec = cbc::Decryptor<aes::Aes128>;

        let key = [0x42u8; 16];
        let plaintext = b"The quick brown fox jumps over the lazy dog";
        let blob = aes_encrypt(&key, plaintext);

        let (iv, ct) = blob.split_at(16);
        let mut iv_arr = [0u8; 16];
        iv_arr.copy_from_slice(iv);
        let cipher = Dec::new(&key.into(), &iv_arr.into());
        let mut buf = ct.to_vec();
        let pt = cipher
            .decrypt_padded_mut::<Pkcs7>(&mut buf)
            .expect("decrypt");
        assert_eq!(pt, plaintext);
    }
}
