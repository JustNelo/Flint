export interface ProcessingResult {
  input_path: string;
  output_path: string;
  success: boolean;
  error: string | null;
  input_size: number;
  output_size: number;
  input_width: number;
  input_height: number;
  output_width: number;
  output_height: number;
}

export interface BatchProgress {
  completed: number;
  total: number;
  results: ProcessingResult[];
}

export interface ImageThumbnail {
  path: string;
  /** Base64 JPEG payload, or null when the source could not be rasterized (e.g. SVG). */
  thumbnail_b64: string | null;
}

export interface PdfExtractionResult {
  pdf_path: string;
  output_dir: string;
  extracted_count: number;
  errors: string[];
}

export type OutputFormat = "png" | "jpg" | "webp" | "bmp" | "ico" | "tiff" | "avif";

export type ResizeMode = "exact" | "width" | "height" | "percentage";

export type WatermarkPosition = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "tiled";

export type PdfWatermarkPosition = WatermarkPosition | "diagonal";

export interface PdfWatermarkResult {
  output_path: string;
  page_count: number;
  errors: string[];
}

export interface MetadataEntry {
  tag: string;
  value: string;
}

export interface ImageMetadata {
  path: string;
  width: number;
  height: number;
  format: string;
  file_size: number;
  bit_depth: string | null;
  color_type: string | null;
  dpi: [number, number] | null;
  exif: MetadataEntry[];
}

export type TabId =
  | "compress"
  | "convert"
  | "resize"
  | "watermark"
  | "strip"
  | "optimize"
  | "crop"
  | "palette"
  | "pdf-toolkit"
  | "favicon"
  | "animation"
  | "spritesheet"
  | "base64"
  | "qrcode"
  | "bulk-rename"
  | "svg-rasterize";

export interface PageThumbnail {
  id: string;
  source_path: string;
  page_number: number;
  thumbnail_b64: string;
  source_type: "pdf" | "image";
}

export interface PdfBuilderItem {
  source_path: string;
  page_number: number | null;
  source_type: "pdf" | "image";
}

export interface MergePdfOptions {
  page_format: string;
  orientation: string;
  margin_px: number;
  image_quality: number;
  output_path: string;
}

export interface MergePdfResult {
  output_path: string;
  page_count: number;
  errors: string[];
}
