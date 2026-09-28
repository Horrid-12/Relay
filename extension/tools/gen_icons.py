import os
import struct
import zlib

def chunk(tag, data):
    out = struct.pack(">I", len(data)) + tag + data
    out += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return out

def png(size, pixels):
    sig = b"\x89PNG\r\n\x1a\n"
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    rows = b""
    for y in range(size):
        rows += b"\x00"
        for x in range(size):
            rows += bytes(pixels(x, y, size))
    return sig + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")

def relay_logo(x, y, size):
    bg = (30, 30, 30)
    fg = (88, 166, 255)
    inner = (30, 30, 30)
    r = size * 0.36
    cx = cy = size / 2.0
    dx = x - cx
    dy = y - cy
    in_circle = dx * dx + dy * dy <= r * r
    ring = in_circle and dx * dx + dy * dy > (r * 0.74) * (r * 0.74)
    if ring:
        return fg
    return bg

def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 32, 48, 128):
        data = png(size, relay_logo)
        path = os.path.join(out_dir, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(data)
        print(f"wrote {path} ({len(data)} bytes)")

if __name__ == "__main__":
    main()