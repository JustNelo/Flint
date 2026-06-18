# Changelog

All notable changes to Flint will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.0.0] - 2025-02-10

### Added

- WebP batch compression with adjustable quality and parallel processing via Rayon.
- Image format conversion between PNG, JPEG, WebP, BMP, ICO and TIFF.
- PDF image extraction supporting DCTDecode, FlateDecode, JPXDecode and CCITTFaxDecode streams.
- Drag-and-drop file selection with extension filtering.
- Click-to-browse file dialog as an alternative to drag-and-drop.
- Custom dark theme with sidebar navigation.
- Custom title bar with minimize, maximize and close controls.
- Toast notifications for operation results (success, partial failure, error).
- Per-file error reporting in the results banner.
- Path traversal validation on all backend commands.
- Content Security Policy enforcement.
- NSIS installer for Windows, DMG for macOS, DEB/RPM/AppImage for Linux.
- GitHub Actions CI/CD pipeline for multi-platform builds and release drafts.
