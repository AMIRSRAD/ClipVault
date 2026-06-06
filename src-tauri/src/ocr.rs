use crate::models::{ClipboardItem, ClipboardKind, OcrResponse};

pub fn run_ocr(item: &ClipboardItem, image_png: Option<&[u8]>) -> OcrResponse {
    if item.kind != ClipboardKind::Image {
        return OcrResponse {
            status: "not_image".to_string(),
            text: None,
            message: "OCR only works on image entries.".to_string(),
        };
    }

    let Some(image_png) = image_png else {
        return OcrResponse {
            status: "failed".to_string(),
            text: None,
            message: "This image entry has no stored image data to scan.".to_string(),
        };
    };

    match recognize_windows_ocr(image_png) {
        Ok(text) if text.trim().is_empty() => OcrResponse {
            status: "ready".to_string(),
            text: Some(String::new()),
            message: "OCR finished, but no readable text was found.".to_string(),
        },
        Ok(text) => OcrResponse {
            status: "ready".to_string(),
            text: Some(text),
            message: "OCR text extracted with Windows OCR.".to_string(),
        },
        Err(error) if is_ocr_unavailable(&error) => OcrResponse {
            status: "unavailable".to_string(),
            text: None,
            message: format!("Windows OCR is unavailable on this system: {error}"),
        },
        Err(error) => OcrResponse {
            status: "failed".to_string(),
            text: None,
            message: format!("OCR failed: {error}"),
        },
    }
}

#[cfg(target_os = "windows")]
fn recognize_windows_ocr(image_png: &[u8]) -> windows::core::Result<String> {
    use windows::{
        Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat},
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream)?;
    writer.WriteBytes(image_png)?;
    writer.StoreAsync()?.get()?;
    writer.FlushAsync()?.get()?;
    writer.DetachStream()?;
    writer.Close()?;
    stream.Seek(0)?;

    let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
    let bitmap = decoder
        .GetSoftwareBitmapConvertedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied)?
        .get()?;

    let max_dimension = OcrEngine::MaxImageDimension()? as i32;
    if bitmap.PixelWidth()? > max_dimension || bitmap.PixelHeight()? > max_dimension {
        return Err(windows::core::Error::new(
            windows::core::HRESULT(0x80070057u32 as i32),
            format!("image is larger than Windows OCR limit of {max_dimension}px"),
        ));
    }

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
    let result = engine.RecognizeAsync(&bitmap)?.get()?;
    Ok(result.Text()?.to_string_lossy())
}

#[cfg(not(target_os = "windows"))]
fn recognize_windows_ocr(_image_png: &[u8]) -> Result<String, String> {
    Err("Windows OCR is only available on Windows.".to_string())
}

#[cfg(target_os = "windows")]
fn is_ocr_unavailable(error: &windows::core::Error) -> bool {
    let code = error.code().0 as u32;
    matches!(code, 0x80040154 | 0x80070490 | 0x80004002 | 0x80004005)
}

#[cfg(not(target_os = "windows"))]
fn is_ocr_unavailable(_error: &String) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_image_items() {
        let item = ClipboardItem {
            id: "test".to_string(),
            kind: ClipboardKind::Text,
            text: Some("hello".to_string()),
            ocr_text: None,
            image_url: None,
            source_app: None,
            source_title: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            last_used_at: None,
            pinned: false,
            tags: vec![],
            size_bytes: 5,
            expires_at: None,
        };

        let response = run_ocr(&item, None);
        assert_eq!(response.status, "not_image");
    }

    #[test]
    fn rejects_image_without_blob() {
        let item = ClipboardItem {
            id: "test".to_string(),
            kind: ClipboardKind::Image,
            text: None,
            ocr_text: None,
            image_url: None,
            source_app: None,
            source_title: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            last_used_at: None,
            pinned: false,
            tags: vec![],
            size_bytes: 0,
            expires_at: None,
        };

        let response = run_ocr(&item, None);
        assert_eq!(response.status, "failed");
    }
}
