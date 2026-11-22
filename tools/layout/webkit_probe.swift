// Load a page in the system WebKit (the engine of Safari on this Mac) and print the text of
// <pre id="__layout"> once the page's probe script has written it. Used by check_layout.mjs (engine safari).
//   swift webkit_probe.swift <file.html>
import AppKit
import WebKit

let path = CommandLine.arguments[1]
let app = NSApplication.shared
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 720))
let window = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = web
let url = URL(fileURLWithPath: path)
web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())

var tries = 0
func poll() {
    web.evaluateJavaScript("(document.getElementById('__layout')||{}).textContent||''") { v, _ in
        if let s = v as? String, !s.isEmpty {
            FileHandle.standardOutput.write(s.data(using: .utf8)!)
            exit(0)
        }
        tries += 1
        if tries > 600 { FileHandle.standardError.write("timeout\n".data(using: .utf8)!); exit(1) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: poll)
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: poll)
app.run()
