export interface GenerationMetadata {
  prompt: string;
  negativePrompt: string;
  model: string;
  seed: string;
  source: string;
  params: Record<string, unknown>;
}

export interface ProcessedFile {
  hash: string;
  size: number;
  type: string;
  width: number | null;
  height: number | null;
  colors: string[];
  phash: string;
  exif: Record<string, unknown>;
  generation: GenerationMetadata;
  snapshotPath: string;
  thumbnailPath: string | null;
}
