use std::fs;
use std::io::{Read, Write};
use std::path::Path;
#[cfg(feature = "gui")]
use tauri::command;
use zip::write::SimpleFileOptions;

#[cfg(feature = "gui")]
#[command]
pub async fn create_zip(source_dir: String, dest_zip: String) -> Result<(), String> {
    let source = Path::new(&source_dir);
    let dest = Path::new(&dest_zip);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let file = fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    fn add_dir(
        zip: &mut zip::ZipWriter<fs::File>,
        base: &Path,
        current: &Path,
        options: SimpleFileOptions,
    ) -> Result<(), String> {
        for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = path.strip_prefix(base).map_err(|e| e.to_string())?;
            let name_str = name.to_string_lossy().replace('\\', "/");

            if path.is_dir() {
                zip.add_directory(&name_str, options)
                    .map_err(|e| e.to_string())?;
                add_dir(zip, base, &path, options)?;
            } else {
                zip.start_file(&name_str, options)
                    .map_err(|e| e.to_string())?;
                let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
                let mut buf = Vec::new();
                f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                zip.write_all(&buf).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    add_dir(&mut zip, source, source, options)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(feature = "gui")]
#[command]
pub async fn extract_zip(zip_path: String, dest_dir: String) -> Result<(), String> {
    let path = Path::new(&zip_path);
    let dest = Path::new(&dest_dir);
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;

    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = dest.join(file.mangled_name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
