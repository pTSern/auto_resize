import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from './ffmpeg.js';
import { ResizeOptions, Dimension } from './types.js';

export const CONFIG_PATH = path.join(os.homedir(), '.auto_resize_config.json');

export interface ConfigDimension {
  w: number;
  h: number;
}

export interface BlurConfig {
  type: 'gaussian' | 'box' | 'smart';
  params: Record<string, any>;
}

interface GlobalConfig {
  dimensions?: ConfigDimension[];
  demensions?: ConfigDimension[];
  replacer?: string;
  blur?: BlurConfig;
}

export interface LoadedConfig {
  dimensions: ConfigDimension[];
  replacer: string;
  blur: BlurConfig;
}

/**
 * Calculates a simplified ratio label from width and height (e.g. 1080x1080 -> 1x1, 1920x1080 -> 16x9)
 */
export function getFractionLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(w, h);
  return `${w / divisor}x${h / divisor}`;
}

/**
 * Loads the global configurations from ~/.auto_resize_config.json
 */
export function loadGlobalConfig(): LoadedConfig {
  const defaultDimensions = [
    { w: 1080, h: 1080 },
    { w: 1920, h: 1080 }
  ];
  const defaultReplacer = '9x16';
  const defaultBlur: BlurConfig = {
    type: 'gaussian',
    params: {
      sigma: 20,
      steps: 3
    }
  };

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
      dimensions: defaultDimensions,
      replacer: defaultReplacer,
      blur: defaultBlur
    };
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    } catch (err: any) {}
    return { dimensions: defaultDimensions, replacer: defaultReplacer, blur: defaultBlur };
  }

  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(content) as GlobalConfig;
    const list = parsed.dimensions || parsed.demensions || defaultDimensions;
    const replacer = parsed.replacer || defaultReplacer;
    const blur = parsed.blur || defaultBlur;

    // Migrate legacy fractional ratios to absolute pixel sizes automatically
    let migrated = false;
    const updatedList = list.map(dim => {
      if (dim.w === 1 && dim.h === 1) { migrated = true; return { w: 1080, h: 1080 }; }
      if (dim.w === 16 && dim.h === 9) { migrated = true; return { w: 1920, h: 1080 }; }
      if (dim.w === 9 && dim.h === 16) { migrated = true; return { w: 1080, h: 1920 }; }
      return dim;
    });

    if (migrated || !parsed.replacer || !parsed.blur) {
      try {
        fs.writeFileSync(
          CONFIG_PATH,
          JSON.stringify({ dimensions: updatedList, replacer, blur }, null, 2),
          'utf-8'
        );
      } catch (e) {}
    }

    return { dimensions: updatedList, replacer, blur };
  } catch (err: any) {
    return { dimensions: defaultDimensions, replacer: defaultReplacer, blur: defaultBlur };
  }
}

interface VideoMetadata {
  width: number;
  height: number;
}

/**
 * Probes the video file to retrieve its display dimensions, taking rotation metadata into account.
 */
export function getVideoMetadata(inputPath: string): Promise<VideoMetadata> {
  const normalizedPath = inputPath.replace(/\\/g, '/');
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(normalizedPath, (err, metadata) => {
      if (err) {
        return reject(new Error(`Failed to probe video: ${err.message}`));
      }
      const stream = metadata.streams.find(s => s.codec_type === 'video');
      if (!stream || stream.width === undefined || stream.height === undefined) {
        return reject(new Error('No valid video stream found in file'));
      }

      let width = stream.width;
      let height = stream.height;

      // Handle video rotation metadata (e.g. from phones)
      const rotationTag = stream.tags?.rotate;
      const sideDataRotation = stream.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation;
      const rotation = Math.abs(parseInt(rotationTag || String(sideDataRotation || 0), 10));

      if (rotation === 90 || rotation === 270) {
        width = stream.height;
        height = stream.width;
      }

      resolve({ width, height });
    });
  });
}

/**
 * Calculates target dimensions based on options and original video metadata.
 */
export function calculateTargetDimensions(options: ResizeOptions, original: VideoMetadata): Dimension {
  let targetW = 1080;
  let targetH = 1080;

  const { aspectRatio, width, height } = options;

  if (aspectRatio === 'custom') {
    if (!width || !height) {
      throw new Error('Custom aspect ratio requires width and height');
    }
    return { width: Math.round(width / 2) * 2, height: Math.round(height / 2) * 2 };
  }

  const srcW = original.width;
  const srcH = original.height;
  const baseDimension = srcH > 0 ? srcH : 1080;

  if (aspectRatio === '1:1') {
    targetW = baseDimension;
    targetH = baseDimension;
  } else if (aspectRatio === '9:16') {
    targetH = baseDimension;
    targetW = Math.round((baseDimension * 9) / 16);
  } else if (aspectRatio === '16:9') {
    targetH = baseDimension;
    targetW = Math.round((baseDimension * 16) / 9);
  }

  targetW = Math.round(targetW / 2) * 2;
  targetH = Math.round(targetH / 2) * 2;

  return { width: targetW, height: targetH };
}

/**
 * Resize a video using a blurred background.
 */
export async function resizeVideo(
  options: ResizeOptions,
  onProgress?: (percent: number) => void
): Promise<void> {
  const inputPath = options.inputPath.replace(/\\/g, '/');
  const outputPath = options.outputPath.replace(/\\/g, '/');
  const { blurSigma } = options;
  const metadata = await getVideoMetadata(inputPath);
  const target = calculateTargetDimensions({ ...options, inputPath, outputPath }, metadata);

  const targetW = target.width;
  const targetH = target.height;

  // Load blur configuration
  const { blur } = loadGlobalConfig();
  let blurFilter = 'gblur';
  let blurOpts: any = { sigma: 20, steps: 3 };

  if (blurSigma !== undefined) {
    // Explicit CLI override
    blurFilter = 'gblur';
    blurOpts = { sigma: blurSigma, steps: 3 };
  } else if (blur && blur.type && blur.params) {
    if (blur.type === 'gaussian') {
      blurFilter = 'gblur';
      blurOpts = {
        sigma: typeof blur.params.sigma === 'number' ? blur.params.sigma : 20,
        steps: typeof blur.params.steps === 'number' ? blur.params.steps : 3
      };
    } else if (blur.type === 'box') {
      blurFilter = 'boxblur';
      blurOpts = {
        lr: typeof blur.params.radius === 'number' ? blur.params.radius : 20,
        lp: typeof blur.params.power === 'number' ? blur.params.power : 2
      };
    } else if (blur.type === 'smart') {
      blurFilter = 'smartblur';
      blurOpts = {
        lr: typeof blur.params.radius === 'number' ? blur.params.radius : 5,
        ls: typeof blur.params.strength === 'number' ? blur.params.strength : 1.0,
        lt: typeof blur.params.threshold === 'number' ? blur.params.threshold : -0.5
      };
    }
  }

  // Build the filter description array for fluent-ffmpeg complexFilter:
  // 1. bg_scale: scale input video so it's large enough to cover the target box completely
  // 2. bg_crop: crop the scaled background to fit the target width and height exactly
  // 3. bg_blur: apply the chosen blur to the cropped background
  // 4. fg_scale: scale original input video to fit inside target box, keeping original aspect ratio
  // 5. overlay: overlay fg centered on top of bg_blur
  const filters = [
    {
      filter: 'scale',
      options: {
        w: targetW,
        h: targetH,
        force_original_aspect_ratio: 'increase'
      },
      inputs: '0:v',
      outputs: 'bg_scale'
    },
    {
      filter: 'crop',
      options: {
        w: targetW,
        h: targetH
      },
      inputs: 'bg_scale',
      outputs: 'bg_crop'
    },
    {
      filter: blurFilter,
      options: blurOpts,
      inputs: 'bg_crop',
      outputs: 'bg_blur'
    },
    {
      filter: 'scale',
      options: {
        w: targetW,
        h: targetH,
        force_original_aspect_ratio: 'decrease'
      },
      inputs: '0:v',
      outputs: 'fg_scale'
    },
    {
      filter: 'overlay',
      options: {
        x: '(W-w)/2',
        y: '(H-h)/2'
      },
      inputs: ['bg_blur', 'fg_scale'],
      outputs: 'outv'
    }
  ];

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .complexFilter(filters)
      .outputOptions([
        '-map [outv]',       // map the video from filter output
        '-map 0:a?',         // map audio if it exists in input (optional)
        '-c:a aac',          // encode audio using AAC
        '-c:v libx264',      // encode video using H.264
        '-pix_fmt yuv420p',  // maximum compatibility pixel format
        '-preset medium'     // balanced speed/quality preset
      ])
      .output(outputPath)
      .on('progress', (progress) => {
        if (onProgress && progress.percent !== undefined) {
          onProgress(Math.max(0, Math.min(100, progress.percent)));
        }
      })
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(new Error(`FFmpeg error: ${err.message}`));
      })
      .run();
  });
}
