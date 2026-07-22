#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { resizeVideo, getVideoMetadata, calculateTargetDimensions } from './index.js';
import { ResizeOptions } from './types.js';

// Open native WinForms Folder browser dialog
function selectFolderDialog(): string | null {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = \'Chon thu muc chua video .mp4\'',
    '$d.ShowNewFolderButton = $false',
    '$win = New-Object System.Windows.Forms.NativeWindow',
    '$win.AssignHandle([System.Diagnostics.Process]::GetCurrentProcess().MainWindowHandle)',
    'if ($d.ShowDialog($win) -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }'
  ].join('; ');

  try {
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`;
    const stdout = execSync(cmd, { encoding: 'utf8' }).trim();
    return stdout || null;
  } catch (e) {
    return null;
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
  console.log(chalk.bold.cyan('       AUTO RESIZE VIDEO - SELECT DIALOG MODE (srs)'));
  console.log(chalk.cyan('===================================================='));
  console.log(chalk.yellow('Đang mở hộp thoại chọn thư mục...'));

  const folderPath = selectFolderDialog();
  if (!folderPath) {
    console.log(chalk.red('Không có thư mục nào được chọn. Đang thoát.'));
    process.exit(0);
  }

  console.log(`\n${chalk.green('Thư mục đã chọn:')} ${folderPath}`);
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

  const sizeAnswer = await askQuestion(chalk.yellow('Kích thước muốn render (1x1, 9x16, 16x9, all) [all]: '));
  let targetRatios: ('1:1' | '9:16' | '16:9')[] = ['1:1', '9:16', '16:9'];
  if (sizeAnswer === '1x1' || sizeAnswer === '1:1') {
    targetRatios = ['1:1'];
  } else if (sizeAnswer === '9x16') {
    targetRatios = ['9:16'];
  } else if (sizeAnswer === '16x9') {
    targetRatios = ['16:9'];
  }

  const files = fs.readdirSync(folderPath)
    .filter(f => f.toLowerCase().endsWith('.mp4'))
    .map(f => path.join(folderPath, f));

  if (files.length === 0) {
    console.log(chalk.red('\nKhông tìm thấy file .mp4 nào trong thư mục này.'));
    process.exit(0);
  }

  console.log(chalk.cyan(`\nTìm thấy ${files.length} video .mp4. Bắt đầu xử lý...\n`));

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

      const outPath = path.join(folderPath, outName);

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
