import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
// @ts-ignore
import ffprobeStatic from 'ffprobe-static';

// Handle CJS/ESM interop of the static path for ffmpeg
const resolvedPath: string | null = typeof ffmpegPath === 'string' 
  ? ffmpegPath 
  : (ffmpegPath as any).default || null;

if (resolvedPath) {
  ffmpeg.setFfmpegPath(resolvedPath);
} else {
  console.warn('ffmpeg-static binary path not found. Falling back to system ffmpeg.');
}

// Handle CJS/ESM interop of the static path for ffprobe
const resolvedFfprobePath: string | null = ffprobeStatic && typeof ffprobeStatic === 'object'
  ? (ffprobeStatic as any).path || (ffprobeStatic as any).default?.path || null
  : null;

if (resolvedFfprobePath) {
  ffmpeg.setFfprobePath(resolvedFfprobePath);
} else {
  console.warn('ffprobe-static binary path not found. Falling back to system ffprobe.');
}



export default ffmpeg;
