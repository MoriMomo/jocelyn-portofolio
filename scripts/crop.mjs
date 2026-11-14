import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SLIDES_DIR = 'C:/Users/kenta/.gemini/antigravity/brain/1c09ce3c-e235-4baf-ac3c-c958c68c8253/scratch/portfolio';
const CROPS_PATH = path.resolve('scripts/crops.json');

async function main() {
  const raw = await fs.readFile(CROPS_PATH, 'utf8');
  const crops = JSON.parse(raw);

  for (const item of crops) {
    const [x0, y0, x1, y1] = item.box;
    const width = x1 - x0;
    const height = y1 - y0;
    const inputPath = path.join(SLIDES_DIR, `${item.slide}.webp`);
    const outputPath = path.resolve(item.out);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    await sharp(inputPath)
      .extract({ left: x0, top: y0, width, height })
      .jpeg({ quality: 92, mozjpeg: true })
      .toFile(outputPath);

    console.log(`Cropped Slide ${item.slide} -> ${item.out} (${width}x${height})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
