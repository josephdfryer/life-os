#!/usr/bin/env python3
"""Lean JSONL export of Photos library metadata for photos-sync.ts.

Only the fields the digest needs — the default osxphotos CLI JSON output
includes full EXIF/cloud metadata per photo (5-10KB each), which blows past
pipe buffer limits at library scale (30k+ photos). One compact JSON object
per line keeps this small and streamable.

Usage: photos_export.py [added-after-iso8601]
"""
import sys
import json
from datetime import datetime

import osxphotos


def main():
    added_after = None
    if len(sys.argv) > 1 and sys.argv[1]:
        added_after = datetime.fromisoformat(sys.argv[1])

    # No from_date filter here — that filters by taken-date, not added-date.
    # date_added filtering happens per-photo below so an old photo imported
    # today (added recently, taken long ago) still gets picked up.
    db = osxphotos.PhotosDB()
    photos = db.photos()

    for p in photos:
        if added_after and p.date_added and p.date_added < added_after:
            continue
        lat, lng = (p.location[0], p.location[1]) if p.location and p.location[0] is not None else (None, None)
        row = {
            "uuid": p.uuid,
            "date": p.date.isoformat() if p.date else None,
            "date_added": p.date_added.isoformat() if p.date_added else None,
            "persons": p.persons or [],
            "ai_caption": getattr(p, "ai_caption", None),
            "original_filename": p.original_filename,
            "latitude": lat,
            "longitude": lng,
            "favorite": p.favorite,
        }
        print(json.dumps(row))


if __name__ == "__main__":
    main()
