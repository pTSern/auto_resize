export interface ResizeOptions {
  inputPath: string;
  outputPath: string;
  aspectRatio?: '1:1' | '9:16' | '16:9' | 'custom';
  width?: number;
  height?: number;
  blurOverrideType?: 'gaussian' | 'box' | 'smart';
  blurOverrideParams?: number[];
}

export interface Dimension {
  width: number;
  height: number;
}
