// draws text labels (JSON: x, y in image pixels from the top, t, c = [r, g, b]) onto a PNG
import AppKit
let a = CommandLine.arguments, inP = a[1], js = a[2], outP = a[3]
guard let img = NSImage(contentsOfFile: inP), let rep0 = img.representations.first else { fatalError("read") }
let W = rep0.pixelsWide, H = rep0.pixelsHigh
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
img.draw(in: NSRect(x: 0, y: 0, width: W, height: H))
let items = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: js))) as! [[String: Any]]
let font = NSFont.systemFont(ofSize: CGFloat(Double(a.count > 4 ? a[4] : "40")!))
for it in items {
  let c = it["c"] as! [Double], s = it["t"] as! String, x = it["x"] as! Double, y = it["y"] as! Double
  let col = NSColor(red: c[0] / 255, green: c[1] / 255, blue: c[2] / 255, alpha: 1)
  let attr: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: col, .backgroundColor: NSColor(white: 1, alpha: 0.75)]
  NSAttributedString(string: s, attributes: attr).draw(at: NSPoint(x: x, y: Double(H) - y - Double(font.pointSize)))
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: outP))
print("ok", W, H, items.count)
