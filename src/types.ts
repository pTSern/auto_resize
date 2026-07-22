export interface ResizeOptions {
  inputPath: string;
  outputPath: string;
  aspectRatio?: '1:1' | '9:16' | '16:9' | 'custom';
  width?: number;
  height?: number;
  blurSigma?: number; // Sigma value for Gaussian blur filter (default: 20)
}

export interface Dimension {
  width: number;
  height: number;
}
