"""Original Cura synthetic fixture; Pillow 12.3.0, no downloaded artwork."""
from pathlib import Path
from PIL import Image, ImageDraw
image = Image.new('RGB', (512, 384), (163, 211, 247))
draw = ImageDraw.Draw(image)
draw.rectangle((0, 295, 512, 384), fill=(68, 153, 75))
draw.ellipse((393, 32, 463, 102), fill=(255, 217, 63))
draw.rectangle((138, 168, 372, 315), fill=(211, 63, 53))
draw.polygon([(110, 172), (255, 54), (400, 172)], fill=(62, 75, 109))
draw.rectangle((231, 229, 280, 315), fill=(114, 67, 40))
for x in [163, 309]:
    draw.rectangle((x, 194, x + 37, 233), fill=(247, 235, 181))
image.save(Path(__file__).parent / 'synthetic-house.png')
