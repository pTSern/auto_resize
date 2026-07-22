#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import chalk from 'chalk';

const CONFIG_PATH = path.join(os.homedir(), '.auto_resize_config.json');

interface Dimension {
  w: number;
  h: number;
}

interface GlobalConfig {
  dimensions?: Dimension[];
  demensions?: Dimension[];
  replacer?: string;
}

interface LoadedConfig {
  dimensions: Dimension[];
  replacer: string;
}

function loadConfig(): LoadedConfig {
  const defaultDimensions = [
    { w: 1080, h: 1080 },
    { w: 1920, h: 1080 }
  ];
  const defaultReplacer = '9x16';

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = { dimensions: defaultDimensions, replacer: defaultReplacer };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return { dimensions: defaultDimensions, replacer: defaultReplacer };
  }

  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(content) as GlobalConfig;
    const list = parsed.dimensions || parsed.demensions || defaultDimensions;
    const replacer = parsed.replacer || defaultReplacer;
    
    // Migrate legacy fractional ratios to absolute pixel sizes automatically
    let migrated = false;
    const updatedList = list.map(dim => {
      if (dim.w === 1 && dim.h === 1) { migrated = true; return { w: 1080, h: 1080 }; }
      if (dim.w === 16 && dim.h === 9) { migrated = true; return { w: 1920, h: 1080 }; }
      if (dim.w === 9 && dim.h === 16) { migrated = true; return { w: 1080, h: 1920 }; }
      return dim;
    });
    if (migrated || !parsed.replacer) {
      saveConfig(updatedList, replacer);
    }
    return { dimensions: updatedList, replacer };
  } catch (err) {
    console.log(chalk.red('Error reading config file, resetting to defaults.'));
  }

  return { dimensions: defaultDimensions, replacer: defaultReplacer };
}

function saveConfig(dimensions: Dimension[], replacer: string): boolean {
  try {
    const config = { dimensions, replacer };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err: any) {
    console.log(chalk.red(`Failed to save config file: ${err.message}`));
    return false;
  }
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function menuLoop() {
  while (true) {
    console.clear();
    const { dimensions, replacer } = loadConfig();
    
    console.log(chalk.cyan('===================================================='));
    console.log(chalk.bold.cyan('        CẤU HÌNH AUTO RESIZE VIDEO (.json)'));
    console.log(chalk.cyan('===================================================='));
    console.log(`${chalk.gray('Đường dẫn config:')} ${CONFIG_PATH}`);
    console.log(`${chalk.green('Đang có tất cả')} ${dimensions.length} ${chalk.green('kích thước đăng ký:')}`);
    console.log(chalk.cyan('----------------------------------------------------'));
    
    if (dimensions.length === 0) {
      console.log(chalk.yellow('  (Trống - Không có kích thước nào)'));
    } else {
      dimensions.forEach((dim, idx) => {
        console.log(`  [${idx + 1}] ${dim.w}x${dim.h}`);
      });
    }
    console.log(chalk.cyan('----------------------------------------------------'));
    console.log(chalk.yellow('  [A] Thêm kích thước mới (Add)'));
    console.log(chalk.yellow('  [D] Xóa kích thước (Delete)'));
    console.log(chalk.yellow(`  [R] Thay đổi chuỗi thay thế (Replacer) [Hiện tại: "${replacer}"]`));
    console.log(chalk.yellow('  [Q] Thoát (Quit)'));
    console.log(chalk.cyan('===================================================='));

    const choice = (await askQuestion(chalk.cyan('Nhập lựa chọn của bạn (A/D/R/Q): '))).toUpperCase();

    if (choice === 'Q' || choice === '') {
      console.log(chalk.green('Tạm biệt!'));
      break;
    }

    if (choice === 'A') {
      console.log(chalk.bold.yellow('\n--- Thêm Kích Thước Mới ---'));
      const wStr = await askQuestion(chalk.yellow('Nhập chiều rộng (Width/W) (e.g. 1080): '));
      const hStr = await askQuestion(chalk.yellow('Nhập chiều cao (Height/H) (e.g. 1080): '));

      const w = parseInt(wStr, 10);
      const h = parseInt(hStr, 10);

      if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
        console.log(chalk.red('\n[LỖI] Kích thước phải là số nguyên dương hợp lệ. Ấn enter để quay lại.'));
        await askQuestion('');
        continue;
      }

      // Check duplicate
      const duplicate = dimensions.some(d => d.w === w && d.h === h);
      if (duplicate) {
        console.log(chalk.red('\n[LỖI] Kích thước này đã tồn tại trong cấu hình. Ấn enter để quay lại.'));
        await askQuestion('');
        continue;
      }

      dimensions.push({ w, h });
      if (saveConfig(dimensions, replacer)) {
        console.log(chalk.green(`\n[OK] Đã thêm kích thước ${w}x${h} thành công! Ấn enter để tiếp tục.`));
      }
      await askQuestion('');
    } 
    else if (choice === 'D') {
      if (dimensions.length === 0) {
        console.log(chalk.yellow('\nHàng đợi config trống. Không có gì để xóa. Ấn enter để quay lại.'));
        await askQuestion('');
        continue;
      }

      console.log(chalk.bold.yellow('\n--- Xóa Kích Thước ---'));
      const idxStr = await askQuestion(chalk.yellow('Nhập số thứ tự muốn xóa (e.g. 1): '));
      const idx = parseInt(idxStr, 10);

      if (isNaN(idx) || idx < 1 || idx > dimensions.length) {
        console.log(chalk.red('\n[LỖI] Số thứ tự không tồn tại. Ấn enter để quay lại.'));
        await askQuestion('');
        continue;
      }

      const removed = dimensions.splice(idx - 1, 1)[0];
      if (saveConfig(dimensions, replacer)) {
        console.log(chalk.green(`\n[OK] Đã xóa kích thước ${removed.w}x${removed.h} thành công! Ấn enter để tiếp tục.`));
      }
      await askQuestion('');
    }
    else if (choice === 'R') {
      console.log(chalk.bold.yellow('\n--- Thay Đổi Chuỗi Thay Thế (Replacer) ---'));
      console.log(`Chuỗi thay thế hiện tại: "${replacer}"`);
      const newReplacer = await askQuestion(chalk.yellow('Nhập chuỗi thay thế mới (e.g. 9x16): '));
      if (newReplacer === '') {
        console.log(chalk.red('\n[LỖI] Chuỗi thay thế không được trống. Ấn enter để quay lại.'));
        await askQuestion('');
        continue;
      }
      if (saveConfig(dimensions, newReplacer)) {
        console.log(chalk.green(`\n[OK] Đã đổi chuỗi thay thế sang "${newReplacer}" thành công! Ấn enter để tiếp tục.`));
      }
      await askQuestion('');
    }
  }
  process.exit(0);
}

menuLoop();
