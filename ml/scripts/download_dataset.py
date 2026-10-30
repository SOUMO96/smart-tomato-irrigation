"""Download the Arnesano multi-sector precision-irrigation dataset (Mendeley Data c837v6p8ph v2, CC BY 4.0).

The Mendeley bulk endpoint serves a *streamed* zip (no central directory) that can be cut off
before the last entries, so entries are parsed from the local headers with zlib instead of zipfile.
Only the files this project needs are kept: documentation, irrigation events and the merged
per-sector 10-minute tables.

Usage: python ml/scripts/download_dataset.py [--zip path/to/existing.zip]
"""
import argparse
import re
import sys
import urllib.request
import zlib
from pathlib import Path

URL = "https://data.mendeley.com/public-api/zip/c837v6p8ph/download/2"
RAW = Path(__file__).resolve().parents[1] / "data" / "raw" / "arnesano"
KEEP = re.compile(r"(README\.md|DATA_DICTIONARY\.md|irrigation_events/.*\.csv|merged/.*\.csv|raw_nominal_flow_rates\.csv)$")


def entries(buf: bytes):
    pos = 0
    while True:
        pos = buf.find(b"PK\x03\x04", pos)
        if pos < 0:
            return
        method = int.from_bytes(buf[pos + 8:pos + 10], "little")
        nlen = int.from_bytes(buf[pos + 26:pos + 28], "little")
        elen = int.from_bytes(buf[pos + 28:pos + 30], "little")
        name = buf[pos + 30:pos + 30 + nlen].decode("utf-8", "replace")
        start = pos + 30 + nlen + elen
        if method == 0:  # stored entries are not used by this server; skip defensively
            pos = start
            continue
        d = zlib.decompressobj(-15)
        try:
            data = d.decompress(buf[start:])
        except zlib.error:
            return
        if not d.eof:  # truncated entry
            print(f"truncated entry skipped: {name}")
            return
        yield name, data
        pos = len(buf) - len(d.unused_data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip")
    args = ap.parse_args()
    if args.zip:
        buf = Path(args.zip).read_bytes()
    else:
        print("downloading (~42 MB)...")
        buf = urllib.request.urlopen(URL, timeout=900).read()
    RAW.mkdir(parents=True, exist_ok=True)
    n = 0
    for name, data in entries(buf):
        if KEEP.search(name) and "03_code" not in name:
            out = RAW / Path(name).name if "merged/" not in name else RAW / "merged" / Path(name).name
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            print(f"saved {out.relative_to(RAW)} ({len(data):,} bytes)")
            n += 1
    if n == 0:
        sys.exit("no files extracted")


if __name__ == "__main__":
    main()
