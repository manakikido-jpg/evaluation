"""PNG原画を保持してWebPを再作成する。実行にはPython 3とPillowが必要。"""
from pathlib import Path
from PIL import Image
import hashlib
import json

root = Path(__file__).resolve().parent.parent / 'assets' / 'shinpu-cards'
manifest_path = root / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
for directory in ['cards-web', 'thumbnails']:
    (root / directory).mkdir(exist_ok=True)
for card in manifest['cards']:
    source = root / card['cardFile']
    original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    with Image.open(source) as image:
        image.load()
        for folder, width, quality, key, size_key, hash_key in [
            ('cards-web', 900, 82, 'webFile', 'webBytes', 'webSha256'),
            ('thumbnails', 360, 78, 'thumbnailFile', 'thumbnailBytes', 'thumbnailSha256'),
        ]:
            relative = f'{folder}/{card["id"]}.webp'
            output = root / relative
            height = round(image.height * width / image.width)
            image.resize((width, height), Image.Resampling.LANCZOS).save(
                output, 'WEBP', quality=quality, method=6)
            data = output.read_bytes()
            card[key] = relative
            card[size_key] = len(data)
            card[hash_key] = hashlib.sha256(data).hexdigest()
    assert hashlib.sha256(source.read_bytes()).hexdigest() == original_hash
report = {
    'cards': len(manifest['cards']),
    'png_bytes': sum(c['cardBytes'] for c in manifest['cards']),
    'web_bytes': sum(c['webBytes'] for c in manifest['cards']),
    'thumbnail_bytes': sum(c['thumbnailBytes'] for c in manifest['cards']),
}
report['web_reduction_percent'] = round((1 - report['web_bytes'] / report['png_bytes']) * 100, 1)
report['thumbnail_reduction_percent'] = round((1 - report['thumbnail_bytes'] / report['png_bytes']) * 100, 1)
manifest['optimization'] = dict(web_width=900, web_quality=82,
                              thumbnail_width=360, thumbnail_quality=78, **report)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
(root / 'optimization-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
