#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { resizeVideo, getVideoMetadata, calculateTargetDimensions, loadGlobalConfig, getFractionLabel } from './index.js';
import { ResizeOptions } from './types.js';

// Open native WinForms File selector dialog allowing multi-file selection
function selectFilesDialog(): string[] {
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    '$d.Filter = \'Video Files (*.mp4)|*.mp4\'',
    '$d.Multiselect = $true',
    '$d.Title = \'Chon cac file video .mp4\'',
    '$win = New-Object System.Windows.Forms.NativeWindow',
    '$win.AssignHandle([System.Diagnostics.Process]::GetCurrentProcess().MainWindowHandle)',
    'if ($d.ShowDialog($win) -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileNames }'
  ].join('; ');

  try {
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`;
    const stdout = execSync(cmd, { encoding: 'utf8' }).trim();
    if (!stdout) return [];
    return stdout.split(/\r?\n/).map(f => f.trim().replace(/\\/g, '/')).filter(f => f.length > 0);
  } catch (e) {
    return [];
  }
}

// Ask terminal questions
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

function getFormattedDate(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '');
}

async function main() {
  console.log(chalk.cyan('===================================================='));
  console.log(chalk.bold.cyan('       AUTO RESIZE VIDEO - MULTI-FILE DIALOG (srs)'));
  console.log(chalk.cyan('===================================================='));
  console.log(chalk.yellow('Đang mở hộp thoại chọn các file video .mp4...'));

  const files = selectFilesDialog();
  if (files.length === 0) {
    console.log(chalk.red('Không có file nào được chọn. Đang thoát.'));
    process.exit(0);
  }

  console.log(`\n${chalk.green('Các file đã chọn:')}`);
  files.forEach(f => console.log(`  - ${path.basename(f)}`));
  console.log(chalk.cyan('----------------------------------------------------'));

  // Load configuration once
  const { dimensions: configDims, replacer } = loadGlobalConfig();

  // Determine duplicated fractions in global configuration
  const fractionCounts: Record<string, number> = {};
  for (const dim of configDims) {
    const frac = getFractionLabel(dim.w, dim.h);
    fractionCounts[frac] = (fractionCounts[frac] || 0) + 1;
  }

  const renameAnswer = (await askQuestion(chalk.yellow('Có đặt lại tên không ( y/n ): '))).toLowerCase();
  
  const yesOptions = ['y', 'c', 'co', 'ye', 'yes'];
  const noOptions = ['', 'n', 'k', 'no', 'ko', 'kh', 'kho', 'kog', 'khong'];

  let shouldRename = false;
  if (yesOptions.includes(renameAnswer)) {
    shouldRename = true;
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

  // Ask if they want to change blur setting
  const blurAnswer = (await askQuestion(chalk.yellow('Có muốn thay đổi cài đặt làm mờ (Blur) không ( y/n ) [n]: '))).toLowerCase();
  
  let tempBlurType: 'gaussian' | 'box' | 'smart' | undefined = undefined;
  let tempBlurParams: number[] | undefined = undefined;

  if (yesOptions.includes(blurAnswer)) {
    console.clear();
    console.log(chalk.cyan('===================================================='));
    console.log(chalk.bold.cyan('        TÙY CHỈNH HIỆU ỨNG LÀM MỜ (TẠM THỜI)'));
    console.log(chalk.cyan('===================================================='));
    console.log('Chọn hiệu ứng làm mờ mới cho lượt chạy này:');
    console.log('  [0] Gaussian Blur (Mịn, chất lượng cao nhất)');
    console.log('  [1] Box Blur (Làm mờ khối - Nhanh, nhẹ)');
    console.log('  [2] Smart Blur (Làm mờ thông minh - Giữ sắc nét biên)');
    console.log(chalk.cyan('----------------------------------------------------'));
    
    const blurChoice = await askQuestion(chalk.cyan('Chọn loại làm mờ [0-2] [Mặc định: 0]: '));
    
    if (blurChoice === '1') {
      tempBlurType = 'box';
      console.log(chalk.bold.yellow('\n--- Cài Đặt Tham Số Box Blur ---'));
      const radStr = await askQuestion('radius - Bán kính làm mờ (Số thực dương) [Mặc định: 20]: ');
      const radius = radStr ? parseFloat(radStr) : 20;
      const powStr = await askQuestion('power - Số lần lặp làm mờ (Số nguyên 1-5) [Mặc định: 2]: ');
      const power = powStr ? parseInt(powStr, 10) : 2;

      tempBlurParams = [
        isNaN(radius) || radius <= 0 ? 20 : radius,
        isNaN(power) || power <= 0 ? 2 : power
      ];
    } else if (blurChoice === '2') {
      tempBlurType = 'smart';
      console.log(chalk.bold.yellow('\n--- Cài Đặt Tham Số Smart Blur ---'));
      const radStr = await askQuestion('radius - Bán kính lân cận (Số thực dương) [Mặc định: 5]: ');
      const radius = radStr ? parseFloat(radStr) : 5;
      const strStr = await askQuestion('strength - Độ mạnh làm mờ (Số thực) [Mặc định: 1.0]: ');
      const strength = strStr ? parseFloat(strStr) : 1.0;
      const thrStr = await askQuestion('threshold - Ngưỡng lọc chi tiết (-30 đến 30) [Mặc định: -0.5]: ');
      const threshold = thrStr ? parseFloat(thrStr) : -0.5;

      tempBlurParams = [
        isNaN(radius) || radius <= 0 ? 5 : radius,
        isNaN(strength) ? 1.0 : strength,
        isNaN(threshold) ? -0.5 : threshold
      ];
    } else {
      tempBlurType = 'gaussian';
      console.log(chalk.bold.yellow('\n--- Cài Đặt Tham Số Gaussian Blur ---'));
      const sigStr = await askQuestion('sigma - Độ mịn làm mờ (Số thực dương) [Mặc định: 20]: ');
      const sigma = sigStr ? parseFloat(sigStr) : 20;
      const stepStr = await askQuestion('steps - Số bước lặp (Số nguyên 1-10) [Mặc định: 3]: ');
      const steps = stepStr ? parseInt(stepStr, 10) : 3;

      tempBlurParams = [
        isNaN(sigma) || sigma <= 0 ? 20 : sigma,
        isNaN(steps) || steps <= 0 ? 3 : steps
      ];
    }
  }

  const sizeAnswer = await askQuestion(chalk.yellow('Kích thước muốn render (1x1, 16x9, all) [all]: '));
  interface TargetDim {
    w: number;
    h: number;
    label: string;
  }
  let targets: TargetDim[] = [
    { w: 1080, h: 1080, label: '1080x1080' },
    { w: 1920, h: 1080, label: '1920x1080' }
  ];
  if (sizeAnswer === '1x1' || sizeAnswer === '1:1') {
    targets = [{ w: 1080, h: 1080, label: '1080x1080' }];
  } else if (sizeAnswer === '16x9') {
    targets = [{ w: 1920, h: 1080, label: '1920x1080' }];
  }

  console.log(chalk.cyan(`\nTiến hành resize ${files.length} video .mp4...\n`));

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const originName = path.basename(filePath);
    console.log(chalk.bold.blue(`\n--- [Video ${i+1}/${files.length}] Xử lý: ${originName} ---`));

    let metadata;
    try {
      metadata = await getVideoMetadata(filePath);
    } catch (err: any) {
      console.error(chalk.red(`  [Bỏ qua] Không thể probe metadata: ${err.message}`));
      continue;
    }

    // Clone the original file if shouldRename is true
    if (shouldRename) {
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const clonedName = `${currentDate}_${gameName}_${owner}_${replacer}_${base}${ext}`;
      const clonedPath = path.join(path.dirname(filePath), clonedName).replace(/\\/g, '/');

      try {
        fs.copyFileSync(filePath, clonedPath);
        console.log(chalk.green(`  [OK] Đã sao chép file gốc sang: ${clonedName}`));
      } catch (err: any) {
        console.error(chalk.red(`  [Lỗi] Không thể sao chép file gốc: ${err.message}`));
      }
    }

    for (const target of targets) {
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const frac = getFractionLabel(target.w, target.h);
      const isDuplicated = fractionCounts[frac] > 1;
      
      let outName: string;
      if (shouldRename) {
        outName = `${currentDate}_${gameName}_${owner}_${frac}_${base}${ext}`;
      } else {
        // Smart Naming Logic (When shouldRename is false)
        const regex = new RegExp(replacer, 'gi');
        if (regex.test(base)) {
          let tempName = base.replace(regex, frac);
          if (isDuplicated) {
            outName = `${tempName}_${target.w}x${target.h}${ext}`;
          } else {
            outName = `${tempName}${ext}`;
          }
        } else {
          if (isDuplicated) {
            outName = `${base}_${frac}_${target.w}x${target.h}${ext}`;
          } else {
            outName = `${base}_${frac}${ext}`;
          }
        }
      }

      // Save output video in the same directory as its original source file
      const outPath = path.join(path.dirname(filePath), outName).replace(/\\/g, '/');

      const jobOpts: ResizeOptions = {
        inputPath: filePath,
        outputPath: outPath,
        aspectRatio: 'custom',
        width: target.w,
        height: target.h,
        blurOverrideType: tempBlurType,
        blurOverrideParams: tempBlurParams
      };

      const targetDim = calculateTargetDimensions(jobOpts, metadata);
      console.log(chalk.cyan(`  -> Kích thước ${frac} (${targetDim.width}x${targetDim.height})`));

      const spinner = ora(`  Đang render... 0%`).start();
      const startTime = Date.now();

      try {
        await resizeVideo(jobOpts, (percent) => {
          spinner.text = `  Đang render... ${Math.round(percent)}%`;
        });
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        spinner.succeed(chalk.green(`  Đã hoàn thành trong ${duration}s!`));
      } catch (jobErr: any) {
        spinner.fail(chalk.red(`  Render thất bại: ${jobErr.message}`));
      }
    }
  }

  console.log(chalk.bold.green('\nTất cả các tiến trình đã hoàn tất!\n'));
}

main().catch(err => {
  console.error(chalk.red(`Đã xảy ra lỗi hệ thống: ${err.message}`));
  process.exit(1);
});
