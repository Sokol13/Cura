#!/usr/bin/env python3
"""Development-only validation against Apple's exact FCPXML 1.7 DTD.

Requires lxml 6.1.1 (BSD-3-Clause) for verification only. Apple DTD is fetched
from the official archive, pinned by SHA-256, and cached outside tracked source.
No DTD or Python runtime is shipped inside generated media packages.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
from fractions import Fraction
import sys
from urllib.request import urlopen
from urllib.parse import urlparse, unquote

URL = 'https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/LegacyDTDsFinalCutPro/FCPXMLDTDv1.7/FCPXMLDTDv1.7.html'
DIGEST = 'd5d1db87d715cd99eddc407e61bb04e898b02aa8262d31ba2f8e5b038f702579'
DEFAULT = Path(__file__).resolve().parent.parent / '.tmp' / 'fcpxml' / 'FCPXMLv1_7.dtd'

class DtdReader(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = 0
        self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag == 'pre':
            self.inside += 1
    def handle_endtag(self, tag):
        if tag == 'pre':
            self.inside -= 1
            self.parts.append('\n')
    def handle_data(self, value):
        if self.inside:
            self.parts.append(value)

def check_dtd(path):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != DIGEST:
        raise ValueError('Official DTD hash mismatch; do not accept changed grammar silently')
    return data

def prepare(path):
    if path.exists():
        check_dtd(path)
        return
    with urlopen(URL, timeout=30) as response:
        page = response.read(2_000_001)
    if len(page) > 2_000_000:
        raise ValueError('Unexpected oversized Apple documentation response')
    reader = DtdReader()
    reader.feed(page.decode('utf-8'))
    data = ''.join(reader.parts).encode('utf-8')
    if hashlib.sha256(data).hexdigest() != DIGEST:
        raise ValueError('Official DTD hash mismatch; inspect the upstream document')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)

def seconds(value):
    if not value or not value.endswith('s'):
        raise ValueError('Missing rational seconds')
    result = Fraction(value[:-1])
    if result < 0 or result.numerator > 2**63-1 or result.denominator > 2**32-1:
        raise ValueError('Time exceeds Apple rational bounds')
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('xml', nargs='?', type=Path)
    parser.add_argument('--dtd', type=Path, default=DEFAULT)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--package', type=Path)
    args = parser.parse_args()
    if args.prepare:
        prepare(args.dtd)
    check_dtd(args.dtd)
    if args.xml is None:
        if not args.prepare:
            parser.error('Provide an XML file, or use --prepare for the development cache')
        print(json.dumps({'dtd': str(args.dtd), 'sha256': DIGEST}))
        return
    from lxml import etree
    document = etree.parse(str(args.xml), etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True))
    dtd = etree.DTD(str(args.dtd))
    if not dtd.validate(document):
        raise ValueError(str(dtd.error_log))
    root = document.getroot()
    assert root.get('version') == '1.7'
    assets = {asset.get('id'): asset for asset in root.findall('./resources/asset')}
    formats = {item.get('id'): item for item in root.findall('./resources/format')}
    sequence = root.find('./event/project/sequence')
    if sequence is None:
        raise ValueError('Expected one serial Cura project sequence')
    frame = seconds(formats[sequence.get('format')].get('frameDuration'))
    elapsed = Fraction(0)
    clips = sequence.findall('./spine/asset-clip')
    for clip in clips:
        offset = seconds(clip.get('offset'))
        duration = seconds(clip.get('duration'))
        start = seconds(clip.get('start'))
        if offset != elapsed or duration <= 0 or (duration/frame).denominator != 1 or (offset/frame).denominator != 1:
            raise ValueError('Clip order, timing or frame alignment mismatch')
        asset = assets[clip.get('ref')]
        available = seconds(asset.get('duration'))
        if available and start + duration > available:
            raise ValueError('Video clip exceeds source duration')
        elapsed += duration
    if elapsed != seconds(sequence.get('duration')):
        raise ValueError('Sequence duration mismatch')
    if args.package:
        directory = args.package.resolve()
        manifest = json.loads((directory/'manifest.json').read_text())
        if len(clips) != len(manifest['timeline']['clips']):
            raise ValueError('Manifest clip count mismatch')
        for clip, record in zip(clips, manifest['timeline']['clips']):
            media = next(item for item in manifest['media'] if item['versionId'] == record['versionId'])
            if clip.get('ref') != media['resourceId']:
                raise ValueError('Manifest exact-version order mismatch')
        for media in manifest['media']:
            file = (directory/media['path']).resolve()
            if not file.is_relative_to(directory):
                raise ValueError('Escaping media path')
            digest = hashlib.sha256()
            size = 0
            with file.open('rb') as source:
                while data := source.read(256*1024):
                    digest.update(data)
                    size += len(data)
            if digest.hexdigest() != media['hash'] or size != media['size']:
                raise ValueError('Retained bytes mismatch')
            link = urlparse(assets[media['resourceId']].get('src'))
            if link.scheme != 'file' or Path(unquote(link.path)).resolve() != file:
                raise ValueError('Media URL has not been relinked to this package')
    print(json.dumps({'dtdSha256': DIGEST, 'clips': len(clips), 'resources': len(assets), 'duration': str(elapsed), 'frameDuration': str(frame)}))

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, AssertionError, ImportError) as error:
        print(f'FCPXML validation failed: {error}', file=sys.stderr)
        sys.exit(1)
