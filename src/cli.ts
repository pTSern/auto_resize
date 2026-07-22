#!/usr/bin/env node

import { cac } from 'cac';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { resizeVideo, getVideoMetadata, calculateTargetDimensions } from './index.js';
import { ResizeOptions } from './types.js';

const CONFIG_PATH = path.join(os.homedir(), '.auto_resize_config.json');

interface ConfigDimension {
  w: number;
  h: number;
}

interface GlobalConfig {
  dimensions?: ConfigDimension[];
  demensions?: ConfigDimension[]; // Support user's exact spelling spelling
}

/**
 * Loads the global configurations from ~/.auto_resize_config.json
 */
function loadGlobalConfig(): ConfigDimension[] {
  const defaultDimensions = [
    { w: 1, h: 1 },
    { w: 9, h: 16 },
    { w: 16, h: 9 }
  ];

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
      dimensions: defaultDimensions
    };
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn(chalk.yellow(`Warning: Could not create default config at ${CONFIG_PATH}: ${err.message}`));
    }
    return defaultDimensions;
  }

  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(content) as GlobalConfig;
    const list = parsed.dimensions || parsed.demensions;
    if (Array.isArray(list) && list.length > 0) {
      return list;
    }
  } catch (err: any) {
    console.warn(chalk.yellow(`Warning: Failed to parse global config at ${CONFIG_PATH}. Using defaults. Error: ${err.message}`));
  }

  return defaultDimensions;
}

const cli = cac('auto-resize');

cli
  .command('<input>', 'Resize a video with blurred background padding')
  .option('-o, --output <path>', 'Output video file path (default: input_aspectRatio.mp4)')
  .option('-r, --ratio <ratio>', 'Target aspect ratio: "1:1", "9:16", or "16:9" (defaults to reading global config if omitted)')
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

      // Determine which aspect ratios / dimensions to build
      interface ConversionJob {
        options: ResizeOptions;
        label: string;
      }

      const jobs: ConversionJob[] = [];

      if (customW && customH) {
        // Custom single job
        const jobOpts: ResizeOptions = {
          inputPath,
          outputPath: '',
          aspectRatio: 'custom',
          width: customW,
          height: customH,
          blurSigma
        };
        const targetDim = calculateTargetDimensions(jobOpts, metadata);
        let outPath = options.output;
        if (!outPath) {
          const dir = path.dirname(inputPath);
          const ext = path.extname(inputPath);
          const base = path.basename(inputPath, ext);
          outPath = path.join(dir, `${base}_${targetDim.width}x${targetDim.height}${ext}`);
        } else {
          outPath = path.resolve(outPath);
        }
        jobOpts.outputPath = outPath;
        jobs.push({ options: jobOpts, label: `${targetDim.width}x${targetDim.height} (custom)` });
      } else if (options.ratio) {
        // Specific aspect ratio job
        const ratio = options.ratio as '1:1' | '9:16' | '16:9';
        const jobOpts: ResizeOptions = {
          inputPath,
          outputPath: '',
          aspectRatio: ratio,
          blurSigma
        };
        const targetDim = calculateTargetDimensions(jobOpts, metadata);
        let outPath = options.output;
        if (!outPath) {
          const dir = path.dirname(inputPath);
          const ext = path.extname(inputPath);
          const base = path.basename(inputPath, ext);
          outPath = path.join(dir, `${base}_${ratio.replace(':', 'x')}${ext}`);
        } else {
          outPath = path.resolve(outPath);
        }
        jobOpts.outputPath = outPath;
        jobs.push({ options: jobOpts, label: `${targetDim.width}x${targetDim.height} (${ratio})` });
      } else {
        // Default mode: Load from global configuration file
        const configDims = loadGlobalConfig();
        console.log(chalk.gray(`Loaded global config from: ${CONFIG_PATH}`));

        for (const dim of configDims) {
          const w = dim.w;
          const h = dim.h;
          
          let jobOpts: ResizeOptions;
          let label: string;
          let suffix: string;

          if (w <= 100 && h <= 100) {
            // It represents an aspect ratio preset
            const ratio = `${w}:${h}` as '1:1' | '9:16' | '16:9';
            jobOpts = {
              inputPath,
              outputPath: '',
              aspectRatio: ratio,
              blurSigma
            };
            const targetDim = calculateTargetDimensions(jobOpts, metadata);
            label = `${targetDim.width}x${targetDim.height} (${ratio})`;
            suffix = `${w}x${h}`;
          } else {
            // It represents absolute target pixel dimensions
            jobOpts = {
              inputPath,
              outputPath: '',
              aspectRatio: 'custom',
              width: w,
              height: h,
              blurSigma
            };
            label = `${w}x${h} (custom)`;
            suffix = `${w}x${h}`;
          }

          let outPath = options.output;
          if (!outPath) {
            const dir = path.dirname(inputPath);
            const ext = path.extname(inputPath);
            const base = path.basename(inputPath, ext);
            outPath = path.join(dir, `${base}_${suffix}${ext}`);
          } else {
            // If custom output is specified but we are generating multiple files, append suffix
            if (configDims.length > 1) {
              const ext = path.extname(options.output);
              const base = path.basename(options.output, ext);
              const dir = path.dirname(options.output);
              outPath = path.join(dir, `${base}_${suffix}${ext}`);
            } else {
              outPath = path.resolve(options.output);
            }
          }

          jobOpts.outputPath = outPath;
          jobs.push({ options: jobOpts, label });
        }
      }

      console.log(chalk.bold.yellow(`\nFound ${jobs.length} resize job(s) to process.`));

      // Process jobs sequentially
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const targetDim = calculateTargetDimensions(job.options, metadata);

        console.log('\n' + chalk.bold.blue(`--- [Job ${i + 1}/${jobs.length}] Configuration ---`));
        console.log(`${chalk.cyan('Input File:')}      ${inputPath}`);
        console.log(`${chalk.cyan('Input Size:')}      ${metadata.width}x${metadata.height}`);
        console.log(`${chalk.cyan('Target Size:')}     ${targetDim.width}x${targetDim.height} (${job.label})`);
        console.log(`${chalk.cyan('Output File:')}     ${job.options.outputPath}`);
        console.log(`${chalk.cyan('Blur Strength:')}   gblur sigma=${blurSigma}`);
        console.log(chalk.bold.blue('----------------------------------------\n'));

        // Ensure directory of output path exists
        const outputDir = path.dirname(job.options.outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const spinner = ora(`Processing job ${i + 1}/${jobs.length}... 0%`).start();
        const startTime = Date.now();

        try {
          await resizeVideo(job.options, (percent) => {
            spinner.text = `Processing job ${i + 1}/${jobs.length}... ${Math.round(percent)}%`;
          });
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          spinner.succeed(chalk.bold.green(`Job ${i + 1} completed successfully in ${duration}s!`));
          console.log(`${chalk.bold('Saved output to:')} ${chalk.underline.yellow(job.options.outputPath)}`);
        } catch (jobErr: any) {
          spinner.fail(chalk.red(`Job ${i + 1} failed!`));
          console.error(chalk.red(jobErr.message));
        }
      }

      console.log(chalk.bold.green('\nAll jobs completed!\n'));

    } catch (error: any) {
      console.error(chalk.red(`\nError occurred during video resizing:`));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

cli.help();
cli.version('1.0.0');

cli.parse();
