// Verificação: a UI do AgenticOw numa child webview do Tauri (primeira parte) e num iframe (cross-site).
// OW_URL = URL autenticada anunciada pelo Host; OW_MODE = child | iframe.
use tauri::{webview::WebviewBuilder, window::WindowBuilder, LogicalPosition, LogicalSize, WebviewUrl};

const PROBE: &str = r#"
(() => {
  if (window.top !== window) return;
  const erros = [];
  const ce = console.error; console.error = (...a) => { erros.push('console: ' + a.map(String).join(' ').slice(0, 160)); ce.apply(console, a) };
  addEventListener('error', e => erros.push('error: ' + (e.message || e.type) + ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '')));
  addEventListener('unhandledrejection', e => erros.push('rejection: ' + String(e.reason).slice(0, 160)));
  setTimeout(() => {
    const texto = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 60);
    fetch('/__ow_probe?n=' + erros.length + '&erros=' + encodeURIComponent(erros.join(' | ').slice(0, 600)) + '&texto=' + encodeURIComponent(texto)).catch(() => {});
  }, 12000);
})();
"#;

fn main() {
    let url = std::env::var("OW_URL").expect("OW_URL");
    let modo = std::env::var("OW_MODE").unwrap_or_else(|_| "child".into());
    tauri::Builder::default()
        .setup(move |app| {
            let janela = WindowBuilder::new(app, "main")
                .title("agenticow-webview-check")
                .inner_size(1280.0, 800.0)
                .build()?;
            if modo == "iframe" {
                let iframe = format!(
                    "addEventListener('DOMContentLoaded', () => {{ const f = document.createElement('iframe'); f.src = {:?}; f.style.cssText = 'border:0;width:100%;height:100%'; document.getElementById('slot').appendChild(f) }})",
                    url
                );
                janela.add_child(
                    WebviewBuilder::new("shell", WebviewUrl::App("index.html".into())).initialization_script(&iframe),
                    LogicalPosition::new(0.0, 0.0),
                    LogicalSize::new(1280.0, 800.0),
                )?;
            } else {
                janela.add_child(
                    WebviewBuilder::new("shell", WebviewUrl::App("index.html".into())),
                    LogicalPosition::new(0.0, 0.0),
                    LogicalSize::new(1280.0, 800.0),
                )?;
                janela.add_child(
                    WebviewBuilder::new("agenticow", WebviewUrl::External(url.parse()?)).initialization_script(PROBE),
                    LogicalPosition::new(0.0, 40.0),
                    LogicalSize::new(1280.0, 760.0),
                )?;
            }
            let h = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(18));
                h.exit(0);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri");
}
