use exif::{In, Tag};
use image::ImageDecoder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MetadataEntry {
    pub tag: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageMetadata {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub file_size: u64,
    pub bit_depth: Option<String>,
    pub color_type: Option<String>,
    pub dpi: Option<(u32, u32)>,
    pub exif: Vec<MetadataEntry>,
}

const EXIF_TAGS: &[(Tag, &str)] = &[
    (Tag::Make, "Camera Make"),
    (Tag::Model, "Camera Model"),
    (Tag::DateTime, "Date/Time"),
    (Tag::DateTimeOriginal, "Date/Time Original"),
    (Tag::ExposureTime, "Exposure Time"),
    (Tag::FNumber, "F-Number"),
    (Tag::ISOSpeed, "ISO Speed"),
    (Tag::FocalLength, "Focal Length"),
    (Tag::FocalLengthIn35mmFilm, "Focal Length (35mm)"),
    (Tag::MeteringMode, "Metering Mode"),
    (Tag::Flash, "Flash"),
    (Tag::WhiteBalance, "White Balance"),
    (Tag::ExposureMode, "Exposure Mode"),
    (Tag::ImageWidth, "EXIF Width"),
    (Tag::ImageLength, "EXIF Height"),
    (Tag::Orientation, "Orientation"),
    (Tag::XResolution, "X Resolution"),
    (Tag::YResolution, "Y Resolution"),
    (Tag::Software, "Software"),
    (Tag::Artist, "Artist"),
    (Tag::Copyright, "Copyright"),
    (Tag::GPSLatitude, "GPS Latitude"),
    (Tag::GPSLongitude, "GPS Longitude"),
    (Tag::GPSAltitude, "GPS Altitude"),
    (Tag::LensModel, "Lens Model"),
    (Tag::ColorSpace, "Color Space"),
    (Tag::PixelXDimension, "Pixel Width"),
    (Tag::PixelYDimension, "Pixel Height"),
];

pub fn read_image_metadata(path: &str) -> Result<ImageMetadata, String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_uppercase())
        .unwrap_or_else(|| "UNKNOWN".to_string());

    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    // Build a single decoder from the header and read both dimensions and color
    // type from it — avoids re-opening the file just for one piece of metadata.
    let decoder = image::ImageReader::open(path)
        .and_then(|r| r.with_guessed_format())
        .map_err(|e| format!("Cannot open file: {}", e))?
        .into_decoder()
        .map_err(|e| format!("Cannot read image: {}", e))?;

    let (width, height) = decoder.dimensions();

    let ct = match decoder.color_type() {
        image::ColorType::L8 => ("8", "Grayscale"),
        image::ColorType::La8 => ("8", "Grayscale+Alpha"),
        image::ColorType::Rgb8 => ("8", "RGB"),
        image::ColorType::Rgba8 => ("8", "RGBA"),
        image::ColorType::L16 => ("16", "Grayscale"),
        image::ColorType::La16 => ("16", "Grayscale+Alpha"),
        image::ColorType::Rgb16 => ("16", "RGB"),
        image::ColorType::Rgba16 => ("16", "RGBA"),
        image::ColorType::Rgb32F => ("32", "RGB Float"),
        image::ColorType::Rgba32F => ("32", "RGBA Float"),
        _ => ("?", "Unknown"),
    };
    let bit_depth = Some(ct.0.to_string());
    let color_type = Some(ct.1.to_string());

    // Extract DPI from EXIF resolution tags
    let mut dpi: Option<(u32, u32)> = None;
    let mut exif_entries: Vec<MetadataEntry> = Vec::new();

    let file = fs::File::open(path).map_err(|e| format!("Cannot open file: {}", e))?;
    let mut buf_reader = std::io::BufReader::new(&file);

    if let Ok(exif_data) = exif::Reader::new().read_from_container(&mut buf_reader) {
        // Try to extract DPI from XResolution / YResolution
        let x_res = exif_data.get_field(Tag::XResolution, In::PRIMARY);
        let y_res = exif_data.get_field(Tag::YResolution, In::PRIMARY);
        if let (Some(xf), Some(yf)) = (x_res, y_res) {
            let x_str = xf.display_value().to_string();
            let y_str = yf.display_value().to_string();
            if let (Ok(x_val), Ok(y_val)) =
                (x_str.trim().parse::<f64>(), y_str.trim().parse::<f64>())
            {
                if x_val > 0.0 && y_val > 0.0 {
                    dpi = Some((x_val.round() as u32, y_val.round() as u32));
                }
            }
        }

        for &(tag, label) in EXIF_TAGS {
            if let Some(field) = exif_data.get_field(tag, In::PRIMARY) {
                let value = field.display_value().with_unit(&exif_data).to_string();
                if !value.is_empty() && value != "unknown" {
                    exif_entries.push(MetadataEntry {
                        tag: label.to_string(),
                        value,
                    });
                }
            }
        }
    }

    Ok(ImageMetadata {
        path: path.to_string(),
        width,
        height,
        format: ext,
        file_size: size,
        bit_depth,
        color_type,
        dpi,
        exif: exif_entries,
    })
}
