fn main() {
    // Load .env from project root into compile-time env vars
    if let Ok(contents) = std::fs::read_to_string("../.env") {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, val)) = line.split_once('=') {
                println!("cargo:rustc-env={}={}", key.trim(), val.trim());
            }
        }
    }
    println!("cargo:rerun-if-changed=../.env");

    patch_ios_info_plist();

    tauri_build::build()
}

// `tauri ios init` が Info.plist を再生成すると CFBundleURLTypes が消えるため、
// ビルドのたびに自動補完する。
fn patch_ios_info_plist() {
    let plist_path = "gen/apple/noto_iOS/Info.plist";
    let Ok(content) = std::fs::read_to_string(plist_path) else {
        return;
    };
    if content.contains("CFBundleURLTypes") {
        return;
    }

    let injection = "\t<key>CFBundleURLTypes</key>\n\
                     \t<array>\n\
                     \t\t<dict>\n\
                     \t\t\t<key>CFBundleURLSchemes</key>\n\
                     \t\t\t<array>\n\
                     \t\t\t\t<string>com.googleusercontent.apps.668042635984-2id3b5m51tegieqag22pbsf1cqsolfi1</string>\n\
                     \t\t\t</array>\n\
                     \t\t</dict>\n\
                     \t</array>\n\
                     </dict>\n\
                     </plist>";
    let patched = content.replace("</dict>\n</plist>", injection);
    let _ = std::fs::write(plist_path, patched);
}
