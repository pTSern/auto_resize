#!/usr/bin/env node

import { cac } from 'cac';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs';
import { resizeVideo, getVideoMetadata, calculateTargetDimensions } from './index.js';
import { ResizeOptions } from './types.js';

const cli = cac('auto-resize');

cli
  .command('<input>', 'Resize a video with blurred background padding')
  .option('-o, --output <path>', 'Output video file path (default: input_aspectRatio.mp4)')
  .option('-r, --ratio <ratio>', 'Target aspect ratio: "1:1", "9:16", or "16:9" (default: "1:1")', { default: '1:1' })
  .option('--width <width>', 'Custom target width in pixels (requires --height)')
  .option('--height <height>', 'Custom target height in pixels (requires --width)')
  .option('--blur <sigma>', 'Gaussian blur sigma value (default: 20)', { default: 20 })
  .action(async (input, options) => {
    try {
      const inputPath = path.resolve(input);
      if (!fs.existsSync(inputPath)) {
        console.error(chalk.red(`\nError: Input file does not exist: ${input}`));
        process.exit(1);
      }

      const ratio = options.ratio as '1:1' | '9:16' | '16:9';
      const customW = options.width ? parseInt(options.width, 10) : undefined;
      const customH = options.height ? parseInt(options.height, 10) : undefined;
      const blurSigma = parseFloat(options.blur);

      if ((customW && !customH) || (!customW && customH)) {
        console.error(chalk.red(`\nError: Both --width and --height must be provided for custom resizing.`));
        process.exit(1);
      }

      // 1. Get original video metadata
      const spinnerMeta = ora('Probing input video...').start();
      let metadata;
      try {
        metadata = await getVideoMetadata(inputPath);
        spinnerMeta.succeed(chalk.green('Probed input video successfully!'));
      } catch (err: any) {
        spinnerMeta.fail(chalk.red('Failed to probe input video.'));
        console.error(chalk.red(err.message));
        process.exit(1);
      }

      // 2. Determine target dimensions
      const resizeOptions: ResizeOptions = {
        inputPath,
        outputPath: '', // resolved below
        aspectRatio: (customW && customH) ? 'custom' : ratio,
        width: customW,
        height: customH,
        blurSigma
      };

      const targetDim = calculateTargetDimensions(resizeOptions, metadata);

      // Determine output path if not specified
      let outputPath = options.output;
      if (!outputPath) {
        const dir = path.dirname(inputPath);
        const ext = path.extname(inputPath);
        const base = path.basename(inputPath, ext);
        const suffix = (customW && customH) ? `${targetDim.width}x${targetDim.height}` : ratio.replace(':', 'x');
        outputPath = path.join(dir, `${base}_${suffix}${ext}`);
      } else {
        outputPath = path.resolve(outputPath);
      }
      resizeOptions.outputPath = outputPath;

      // Print operational overview
      console.log('\n' + chalk.bold.blue('--- Video Resize Configuration ---'));
      console.log(`${chalk.cyan('Input File:')}      ${inputPath}`);
      console.log(`${chalk.cyan('Input Size:')}      ${metadata.width}x${metadata.height}`);
      console.log(`${chalk.cyan('Target Size:')}     ${targetDim.width}x${targetDim.height} (${resizeOptions.aspectRatio === 'custom' ? 'custom' : ratio})`);
      console.log(`${chalk.cyan('Output File:')}     ${outputPath}`);
      console.log(`${chalk.cyan('Blur Strength:')}   gblur sigma=${blurSigma}`);
      console.log(chalk.bold.blue('----------------------------------\n'));

      // Ensure directory of output path exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 3. Perform resize operation
      const spinner = ora('Resizing video... 0%').start();
      const startTime = Date.now();

      await resizeVideo(resizeOptions, (percent) => {
        spinner.text = `Resizing video... ${Math.round(percent)}%`;
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      spinner.succeed(chalk.bold.green(`Video resized successfully in ${duration}s!`));
      console.log(`${chalk.bold('Saved output to:')} ${chalk.underline.yellow(outputPath)}\n`);

    } catch (error: any) {
      console.error(chalk.red(`\nError occurred during video resizing:`));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

cli.help();
cli.version('1.0.0');

cli.parse();
