use lopdf::{dictionary, Document as LopdfDocument, Object, ObjectId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::progress::emit_progress_simple;
use crate::utils::{deep_clone_object, ensure_output_dir, file_stem};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PdfSplitResult {
    pub output_files: Vec<String>,
    pub errors: Vec<String>,
}

/// Parse a range string like "1-3, 4-10, 11-end" into Vec<(start, end)> pairs.
/// Page numbers are 1-indexed. "end" means the last page.
fn parse_ranges(ranges_str: &str, total_pages: u32) -> Result<Vec<(u32, u32)>, String> {
    let mut result = Vec::new();

    for part in ranges_str.split(',') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(dash_pos) = trimmed.find('-') {
            let start_str = trimmed[..dash_pos].trim();
            let end_str = trimmed[dash_pos + 1..].trim();

            let start: u32 = start_str
                .parse()
                .map_err(|_| format!("Invalid start page: '{}'", start_str))?;

            let end: u32 =
                if end_str.eq_ignore_ascii_case("end") || end_str.eq_ignore_ascii_case("fin") {
                    total_pages
                } else {
                    end_str
                        .parse()
                        .map_err(|_| format!("Invalid end page: '{}'", end_str))?
                };

            if start == 0 || end == 0 {
                return Err("Page numbers must be >= 1".to_string());
            }
            if start > end {
                return Err(format!("Invalid range: {}-{} (start > end)", start, end));
            }
            if end > total_pages {
                return Err(format!(
                    "Page {} exceeds total pages ({})",
                    end, total_pages
                ));
            }

            result.push((start, end));
        } else {
            // Single page number
            let page: u32 = trimmed
                .parse()
                .map_err(|_| format!("Invalid page number: '{}'", trimmed))?;

            if page == 0 || page > total_pages {
                return Err(format!("Page {} is out of range (1-{})", page, total_pages));
            }
            result.push((page, page));
        }
    }

    if result.is_empty() {
        return Err("No valid page ranges provided".to_string());
    }

    Ok(result)
}

pub fn split_pdf(
    pdf_path: &str,
    ranges_str: &str,
    output_dir: &str,
    output_stem: Option<&str>,
    app_handle: &tauri::AppHandle,
) -> PdfSplitResult {
    let mut result = PdfSplitResult {
        output_files: Vec::new(),
        errors: Vec::new(),
    };

    let out_dir = PathBuf::from(output_dir);
    if let Err(e) = ensure_output_dir(&out_dir) {
        result.errors.push(e);
        return result;
    }

    let source_doc = match LopdfDocument::load(pdf_path) {
        Ok(d) => d,
        Err(e) => {
            result
                .errors
                .push(format!("Cannot load PDF '{}': {}", pdf_path, e));
            return result;
        }
    };

    let total_pages = source_doc.get_pages().len() as u32;

    let ranges = match parse_ranges(ranges_str, total_pages) {
        Ok(r) => r,
        Err(e) => {
            result.errors.push(e);
            return result;
        }
    };

    let pdf_stem = output_stem
        .map(|s| s.to_string())
        .unwrap_or_else(|| file_stem(pdf_path));
    let source_pages = source_doc.get_pages();

    let total_ranges = ranges.len();

    for (idx, (start, end)) in ranges.iter().enumerate() {
        let mut new_doc = LopdfDocument::with_version("1.7");
        let pages_id = new_doc.new_object_id();
        let mut page_refs: Vec<Object> = Vec::new();
        let mut id_map: HashMap<ObjectId, ObjectId> = HashMap::new();

        let mut range_error: Option<String> = None;
        for page_num in *start..=*end {
            if let Some(&page_obj_id) = source_pages.get(&page_num) {
                let new_page_id =
                    match deep_clone_object(&mut new_doc, &source_doc, page_obj_id, &mut id_map) {
                        Ok(id) => id,
                        Err(e) => {
                            range_error =
                                Some(format!("Range {}-{}: page {}: {}", start, end, page_num, e));
                            break;
                        }
                    };

                // Point the copied page's Parent to our new Pages node
                if let Ok(Object::Dictionary(ref mut dict)) = new_doc.get_object_mut(new_page_id) {
                    dict.set("Parent", Object::Reference(pages_id));
                }

                page_refs.push(Object::Reference(new_page_id));
            }
        }

        if let Some(e) = range_error {
            result.errors.push(e);
            emit_progress_simple(app_handle, idx + 1, total_ranges, pdf_path);
            continue;
        }

        let page_count = page_refs.len() as i64;
        let pages = dictionary! {
            "Type" => "Pages",
            "Kids" => page_refs,
            "Count" => page_count
        };
        new_doc.objects.insert(pages_id, Object::Dictionary(pages));

        let catalog_id = new_doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id
        });
        new_doc.trailer.set("Root", Object::Reference(catalog_id));

        let output_filename = if *start == *end {
            format!("{}_page_{}.pdf", pdf_stem, start)
        } else {
            format!("{}_pages_{}-{}.pdf", pdf_stem, start, end)
        };
        let output_path = out_dir.join(&output_filename);

        match new_doc.save(&output_path) {
            Ok(_) => {
                result
                    .output_files
                    .push(output_path.to_string_lossy().to_string());
            }
            Err(e) => {
                result
                    .errors
                    .push(format!("Range {}-{}: failed to save — {}", start, end, e));
            }
        }
        emit_progress_simple(app_handle, idx + 1, total_ranges, pdf_path);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ranges_simple() {
        let r = parse_ranges("1-3", 10).unwrap();
        assert_eq!(r, vec![(1, 3)]);
    }

    #[test]
    fn parse_ranges_multiple() {
        let r = parse_ranges("1-3, 5-7, 10", 10).unwrap();
        assert_eq!(r, vec![(1, 3), (5, 7), (10, 10)]);
    }

    #[test]
    fn parse_ranges_end_keyword() {
        let r = parse_ranges("5-end", 20).unwrap();
        assert_eq!(r, vec![(5, 20)]);
    }

    #[test]
    fn parse_ranges_fin_keyword() {
        let r = parse_ranges("1-fin", 8).unwrap();
        assert_eq!(r, vec![(1, 8)]);
    }

    #[test]
    fn parse_ranges_single_page() {
        let r = parse_ranges("4", 10).unwrap();
        assert_eq!(r, vec![(4, 4)]);
    }

    #[test]
    fn parse_ranges_start_greater_than_end() {
        assert!(parse_ranges("5-3", 10).is_err());
    }

    #[test]
    fn parse_ranges_exceeds_total() {
        assert!(parse_ranges("1-15", 10).is_err());
    }

    #[test]
    fn parse_ranges_zero_page() {
        assert!(parse_ranges("0-3", 10).is_err());
    }

    #[test]
    fn parse_ranges_empty_string() {
        assert!(parse_ranges("", 10).is_err());
    }

    #[test]
    fn parse_ranges_whitespace_tolerance() {
        let r = parse_ranges("  1 - 3 , 5 - end  ", 10).unwrap();
        assert_eq!(r, vec![(1, 3), (5, 10)]);
    }
}
