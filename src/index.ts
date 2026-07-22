import ffmpeg from './ffmpeg.js';
import { ResizeOptions, Dimension } from './types.js';

interface VideoMetadata {
  width: number;
  height: number;
}

/**
 * Probes the video file to retrieve its display dimensions, taking rotation metadata into account.
 */
export function getVideoMetadata(inputPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
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

  if (options.width && options.height) {
    targetW = options.width;
    targetH = options.height;
  } else {
    // Determine dimensions dynamically based on original source height
    // to maintain resolution quality (e.g. if input height is 1080p, we keep the vertical tier)
    const baseDimension = original.height > 0 ? original.height : 1080;

    switch (options.aspectRatio) {
      case '1:1':
        targetW = baseDimension;
        targetH = baseDimension;
        break;
      case '9:16':
        // Standard HD vertical aspect ratio calculation
        targetH = baseDimension;
        // Make sure it is proportional to 9:16 (approx width = height * 9 / 16)
        targetW = Math.round((baseDimension * 9) / 16);
        break;
      case '16:9':
        targetH = baseDimension;
        targetW = Math.round((baseDimension * 16) / 9);
        break;
      default:
        // Default to 1:1 if nothing specified
        targetW = baseDimension;
        targetH = baseDimension;
    }
  }

  // FFmpeg requires even dimensions for H.264/yuv420p video codecs
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
  const { inputPath, outputPath, blurSigma = 20 } = options;
  const metadata = await getVideoMetadata(inputPath);
  const target = calculateTargetDimensions(options, metadata);

  const targetW = target.width;
  const targetH = target.height;

  // Build the filter description array for fluent-ffmpeg complexFilter:
  // 1. bg_scale: scale input video so it's large enough to cover the target box completely
  // 2. bg_crop: crop the scaled background to fit the target width and height exactly
  // 3. bg_blur: apply Gaussian blur to the cropped background
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
      filter: 'gblur',
      options: {
        sigma: blurSigma,
        steps: 3
      },
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
