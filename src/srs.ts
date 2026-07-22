#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { resizeVideo, getVideoMetadata, calculateTargetDimensions } from './index.js';
import { ResizeOptions } from './types.js';

// Open native WinForms File selector dialog allowing multi-file selection
function selectFilesDialog(): string[] {
  const script = [
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
    return stdout.split(/\r?\n/).map(f => f.trim()).filter(f => f.length > 0);
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

  const sizeAnswer = await askQuestion(chalk.yellow('Kích thước muốn render (1x1, 16x9, all) [all]: '));
  let targetRatios: ('1:1' | '16:9')[] = ['1:1', '16:9'];
  if (sizeAnswer === '1x1' || sizeAnswer === '1:1') {
    targetRatios = ['1:1'];
  } else if (sizeAnswer === '16x9') {
    targetRatios = ['16:9'];
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

    for (const ratio of targetRatios) {
      const ratioSuffix = ratio.replace(':', 'x');
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      
      let outName: string;
      if (shouldRename) {
        outName = `${currentDate}_${gameName}_${owner}_${ratioSuffix}_${base}${ext}`;
      } else {
        outName = `${base}_${ratioSuffix}${ext}`;
      }

      // Save output video in the same directory as its original source file
      const outPath = path.join(path.dirname(filePath), outName);

      const jobOpts: ResizeOptions = {
        inputPath: filePath,
        outputPath: outPath,
        aspectRatio: ratio,
        blurSigma: 20
      };

      const targetDim = calculateTargetDimensions(jobOpts, metadata);
      console.log(chalk.cyan(`  -> Kích thước ${ratioSuffix} (${targetDim.width}x${targetDim.height})`));

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
