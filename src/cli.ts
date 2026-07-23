#!/usr/bin/env node

import { cac } from 'cac';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs';
import os from 'os';
import readline from 'readline';
import { resizeVideo, getVideoMetadata, calculateTargetDimensions, loadGlobalConfig, getFractionLabel } from './index.js';
import { ResizeOptions } from './types.js';

/**
 * Helper to prompt the user for input in the terminal.
 */
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Formats the current date into ddmmyy format.
 */
function getFormattedDate(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

/**
 * Removes characters that are illegal in file names.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '');
}

/**
 * Non-recursively scans a directory for files ending in .mp4.
 */
function findMp4Files(dirPath: string): string[] {
  try {
    const files = fs.readdirSync(dirPath);
    return files
      .filter(f => f.toLowerCase().endsWith('.mp4'))
      .map(f => path.join(dirPath, f).replace(/\\/g, '/'));
  } catch (err) {
    return [];
  }
}

const cli = cac('auto-resize');

cli
  .command('[input]', 'Resize video files with blurred background padding')
  .option('-o, --output <path>', 'Output video folder or path')
  .option('-r, --ratio <ratio>', 'Target aspect ratio: "1:1", "9:16", or "16:9" (defaults to loading config presets if omitted)')
  .option('--width <width>', 'Custom target width in pixels (requires --height)')
  .option('--height <height>', 'Custom target height in pixels (requires --width)')
  .option('--blur <sigma>', 'Gaussian blur sigma value override (falls back to config if omitted)')
  .action(async (input, options) => {
    try {
      let filesToProcess: string[] = [];

      // 1. Determine input files
      if (!input) {
        // Default: Scan current working directory for .mp4 files
        const cwd = process.cwd().replace(/\\/g, '/');
        filesToProcess = findMp4Files(cwd);
        if (filesToProcess.length === 0) {
          console.error(chalk.red(`\nError: Không tìm thấy file .mp4 nào trong thư mục hiện tại: ${cwd}`));
          process.exit(1);
        }
      } else {
        // Sanitize path (convert double slash c:// to c:/ and eliminate duplicate slashes)
        const cleanedInput = input.replace(/^([a-zA-Z]):\/\/+/, '$1:/').replace(/([^:]|^)\/\/+/g, '$1/').replace(/\\/g, '/');
        const inputPath = path.resolve(cleanedInput).replace(/\\/g, '/');
        if (!fs.existsSync(inputPath)) {
          console.error(chalk.red(`\nError: Đường dẫn đầu vào không tồn tại: ${input}`));
          process.exit(1);
        }

        const stat = fs.statSync(inputPath);
        if (stat.isDirectory()) {
          // If directory is specified, scan it for .mp4 files
          filesToProcess = findMp4Files(inputPath);
          if (filesToProcess.length === 0) {
            console.error(chalk.red(`\nError: Không tìm thấy file .mp4 nào trong thư mục: ${input}`));
            process.exit(1);
          }
        } else {
          // If specific file is specified
          if (!inputPath.toLowerCase().endsWith('.mp4')) {
            console.error(chalk.red(`\nError: File đầu vào phải có định dạng .mp4: ${input}`));
            process.exit(1);
          }
          filesToProcess = [inputPath];
        }
      }

      const customW = options.width ? parseInt(options.width, 10) : undefined;
      const customH = options.height ? parseInt(options.height, 10) : undefined;
      const blurSigma = options.blur ? parseFloat(options.blur) : undefined;

      if ((customW && !customH) || (!customW && customH)) {
        console.error(chalk.red(`\nError: Both --width and --height must be provided for custom resizing.`));
        process.exit(1);
      }

      console.log(chalk.cyan(`Đã tìm thấy ${filesToProcess.length} file .mp4 để tiến hành xử lý.`));

      // 2. Ask if they want to rename
      const renameAnswer = (await askQuestion(chalk.yellow('Có đặt lại tên không ( y/n ): '))).toLowerCase();
      
      const yesOptions = ['y', 'c', 'co', 'ye', 'yes'];
      const noOptions = ['', 'n', 'k', 'no', 'ko', 'kh', 'kho', 'kog', 'khong'];

      let shouldRename = false;
      if (yesOptions.includes(renameAnswer)) {
        shouldRename = true;
      } else if (noOptions.includes(renameAnswer)) {
        shouldRename = false;
      } else {
        // Default to false (no rename) if they put something else
        shouldRename = false;
      }

      let gameName = '';
      let owner = '';
      const currentDate = getFormattedDate();

      if (shouldRename) {
        const rawGameName = await askQuestion(chalk.yellow('Tên game là gì: '));
        const rawOwner = await askQuestion(chalk.yellow('Chủ sở hữu: '));

        gameName = sanitizeFilename(rawGameName) || 'UnknownGame';
        owner = sanitizeFilename(rawOwner) || 'UnknownOwner';
      }

      interface ConversionJob {
        options: ResizeOptions;
        label: string;
      }

      const jobs: ConversionJob[] = [];

      // Load configuration once
      const { dimensions: configDims, replacer } = loadGlobalConfig();

      // Determine duplicated fractions in global configuration
      const fractionCounts: Record<string, number> = {};
      for (const dim of configDims) {
        const frac = getFractionLabel(dim.w, dim.h);
        fractionCounts[frac] = (fractionCounts[frac] || 0) + 1;
      }

      // 3. Configure jobs for each file
      for (const filePath of filesToProcess) {
        const originName = path.basename(filePath);
        let metadata;
        try {
          metadata = await getVideoMetadata(filePath);
        } catch (err: any) {
          console.error(chalk.red(`\n[Bỏ qua] Không thể probe metadata của file ${originName}: ${err.message}`));
          continue;
        }

        // Helper to format output filepath based on the custom naming rule
        const buildOutputPath = (w: number, h: number): string => {
          const ext = path.extname(filePath);
          const base = path.basename(filePath, ext);
          const frac = getFractionLabel(w, h);
          const isDuplicated = fractionCounts[frac] > 1;

          let formattedName: string;
          if (shouldRename) {
            // Format: ddmmyy_%game_name%_%owner%_%the_target_size%_%origin_name%
            formattedName = `${currentDate}_${gameName}_${owner}_${frac}_${base}${ext}`;
          } else {
            // Smart Naming Logic (When shouldRename is false)
            const regex = new RegExp(replacer, 'gi');
            if (regex.test(base)) {
              let tempName = base.replace(regex, frac);
              if (isDuplicated) {
                formattedName = `${tempName}_${w}x${h}${ext}`;
              } else {
                formattedName = `${tempName}${ext}`;
              }
            } else {
              if (isDuplicated) {
                formattedName = `${base}_${frac}_${w}x${h}${ext}`;
              } else {
                formattedName = `${base}_${frac}${ext}`;
              }
            }
          }
          
          let targetDir = path.dirname(filePath);

          if (options.output) {
            const resolvedOut = path.resolve(options.output);
            try {
              // If output parameter is a directory, place output files inside it
              if (fs.existsSync(resolvedOut) && fs.statSync(resolvedOut).isDirectory()) {
                targetDir = resolvedOut;
              } else if (!fs.existsSync(resolvedOut)) {
                // If it doesn't exist, create it as a folder if it doesn't have a file extension
                if (!path.extname(resolvedOut)) {
                  fs.mkdirSync(resolvedOut, { recursive: true });
                  targetDir = resolvedOut;
                } else {
                  // If it has a file extension, treat its directory parent as target folder
                  targetDir = path.dirname(resolvedOut);
                }
              }
            } catch (err) {}
          }

          return path.join(targetDir, formattedName).replace(/\\/g, '/');
        };

        // Clone the original file if shouldRename is true
        if (shouldRename) {
          const ext = path.extname(filePath);
          const base = path.basename(filePath, ext);
          let targetDir = path.dirname(filePath);

          if (options.output) {
            const resolvedOut = path.resolve(options.output);
            try {
              if (fs.existsSync(resolvedOut) && fs.statSync(resolvedOut).isDirectory()) {
                targetDir = resolvedOut;
              } else if (!fs.existsSync(resolvedOut)) {
                if (!path.extname(resolvedOut)) {
                  fs.mkdirSync(resolvedOut, { recursive: true });
                  targetDir = resolvedOut;
                } else {
                  targetDir = path.dirname(resolvedOut);
                }
              }
            } catch (err) {}
          }

          const clonedName = `${currentDate}_${gameName}_${owner}_${replacer}_${base}${ext}`;
          const clonedPath = path.join(targetDir, clonedName).replace(/\\/g, '/');

          try {
            fs.copyFileSync(filePath, clonedPath);
            console.log(chalk.green(`  [OK] Đã sao chép file gốc sang: ${clonedName}`));
          } catch (err: any) {
            console.error(chalk.red(`  [Lỗi] Không thể sao chép file gốc: ${err.message}`));
          }
        }

        if (customW && customH) {
          // Custom dimensions conversion
          const jobOpts: ResizeOptions = {
            inputPath: filePath,
            outputPath: buildOutputPath(customW, customH),
            aspectRatio: 'custom',
            width: customW,
            height: customH,
            blurSigma
          };
          jobs.push({ options: jobOpts, label: `${customW}x${customH} (custom)` });
        } else if (options.ratio) {
          // Specific aspect ratio conversion
          const ratio = options.ratio as '1:1' | '9:16' | '16:9';
          const jobOpts: ResizeOptions = {
            inputPath: filePath,
            outputPath: '', // Temporarily empty, will fill below
            aspectRatio: ratio,
            blurSigma
          };
          const targetDim = calculateTargetDimensions(jobOpts, metadata);
          jobOpts.outputPath = buildOutputPath(targetDim.width, targetDim.height);
          jobs.push({ options: jobOpts, label: `${targetDim.width}x${targetDim.height} (${ratio})` });
        } else {
          // Default: Generate all targets loaded from global config
          for (const dim of configDims) {
            const w = dim.w;
            const h = dim.h;
            
            let jobOpts: ResizeOptions;
            let label: string;

            if (w <= 100 && h <= 100) {
              const ratio = `${w}:${h}` as '1:1' | '9:16' | '16:9';
              jobOpts = {
                inputPath: filePath,
                outputPath: '', // Will fill below
                aspectRatio: ratio,
                blurSigma
              };
              const targetDim = calculateTargetDimensions(jobOpts, metadata);
              jobOpts.outputPath = buildOutputPath(targetDim.width, targetDim.height);
              label = `${targetDim.width}x${targetDim.height} (${ratio})`;
            } else {
              jobOpts = {
                inputPath: filePath,
                outputPath: buildOutputPath(w, h),
                aspectRatio: 'custom',
                width: w,
                height: h,
                blurSigma
              };
              label = `${w}x${h} (custom)`;
            }
            jobs.push({ options: jobOpts, label });
          }
        }
      }

      console.log(chalk.bold.yellow(`\nXác nhận lập hàng đợi ${jobs.length} phiên bản video để bắt đầu chuyển đổi.`));

      // 4. Run jobs sequentially
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const originName = path.basename(job.options.inputPath);

        console.log('\n' + chalk.bold.blue(`--- [Chuyển đổi ${i + 1}/${jobs.length}] Configuration ---`));
        console.log(`${chalk.cyan('File gốc:')}       ${originName}`);
        console.log(`${chalk.cyan('Cấu hình:')}       ${job.label}`);
        console.log(`${chalk.cyan('File đầu ra:')}    ${job.options.outputPath}`);
        console.log(`${chalk.cyan('Hiệu ứng Blur:')}   ${blurSigma !== undefined ? 'Gaussian (sigma=' + blurSigma + ')' : 'Theo cấu hình hệ thống (Config default)'}`);
        console.log(chalk.bold.blue('----------------------------------------\n'));

        // Ensure directory of output path exists
        const outputDir = path.dirname(job.options.outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const spinner = ora(`Đang xử lý ${i + 1}/${jobs.length}... 0%`).start();
        const startTime = Date.now();

        try {
          await resizeVideo(job.options, (percent) => {
            spinner.text = `Đang xử lý ${i + 1}/${jobs.length}... ${Math.round(percent)}%`;
          });
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          spinner.succeed(chalk.bold.green(`Đã hoàn thành video ${i + 1} trong ${duration}s!`));
          console.log(`${chalk.bold('Đã lưu file tại:')} ${chalk.underline.yellow(job.options.outputPath)}`);
        } catch (jobErr: any) {
          spinner.fail(chalk.red(`Chuyển đổi video ${i + 1} thất bại!`));
          console.error(chalk.red(jobErr.message));
        }
      }

      console.log(chalk.bold.green('\nTất cả các tiến trình đã hoàn tất!\n'));

    } catch (error: any) {
      console.error(chalk.red(`\nĐã xảy ra lỗi trong quá trình xử lý video:`));
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  });

cli.help();
cli.version('1.0.0');

cli.parse();
