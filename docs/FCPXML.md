# FCPXML 1.7 export

Cura's timeline uses an explicit ordered list of exact asset-version pins. Durations use project frames; video in-points use source frames. Timing is reduced rational arithmetic, including the exact 24000/1001 timebase. Still images have editable durations; board coordinates do not define story order.

The supported interchange subset is one serial project spine, PNG/JPEG stills, and constant-frame-rate H.264/HEVC MP4/MOV with one video track and zero or one mono/stereo audio track. The bounded ISO-BMFF probe reads metadata, not movie payloads, and rejects variable frame rates, fragmented movies, unsupported codecs, complex edits, and missing timing. This is header validation, not a codec decoder. Convert unsupported source material outside Cura and import the result. No FFmpeg executable is required.

## Independent developer validation

Install `python3 -m pip install lxml==6.1.1`, then run:

```sh
python3 scripts/validate-fcpxml.py --prepare
python3 scripts/validate-fcpxml.py /path/to/timeline.fcpxml
python3 scripts/validate-fcpxml.py /path/to/extracted/timeline.fcpxml --package /path/to/extracted
```

The prepare step downloads the [official Apple FCPXML 1.7 DTD](https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/LegacyDTDsFinalCutPro/FCPXMLDTDv1.7/FCPXMLDTDv1.7.html) into ignored `.tmp/fcpxml/FCPXMLv1_7.dtd`. Its extracted SHA-256 is `d5d1db87d715cd99eddc407e61bb04e898b02aa8262d31ba2f8e5b038f702579`. Validation fails if it differs. Apple retains copyright in the DTD; it is neither vendored nor redistributed in Cura runtime/media packages. lxml is BSD-3-Clause and is used only for development verification, independently of the TypeScript generator.

The validator uses the DTD to check grammar and ID references, and Python `Fraction` to check timeline totals, offsets, frame alignment, and source boundaries. With `--package`, it also verifies exact-version order, SHA-256, sizes, and relocated file URLs. Automated tests exercise 24, 25, 30, and 24000/1001 frame rates and intentionally broken references.

Actual import into Final Cut Pro requires a macOS smoke test. Linux DTD validation does not establish behavior in Final Cut Pro or on physical Windows/macOS machines.
