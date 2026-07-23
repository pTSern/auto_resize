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
  blur?: BlurConfig;
}

interface BlurConfig {
  type: 'gaussian' | 'box' | 'smart';
  params: Record<string, any>;
}

interface LoadedConfig {
  dimensions: Dimension[];
  replacer: string;
  blur: BlurConfig;
}

function loadConfig(): LoadedConfig {
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
    const defaultConfig = { dimensions: defaultDimensions, replacer: defaultReplacer, blur: defaultBlur };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
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
      saveConfig(updatedList, replacer, blur);
    }
    return { dimensions: updatedList, replacer, blur };
  } catch (err) {
    console.log(chalk.red('Error reading config file, resetting to defaults.'));
  }

  return { dimensions: defaultDimensions, replacer: defaultReplacer, blur: defaultBlur };
}

function saveConfig(dimensions: Dimension[], replacer: string, blur: BlurConfig): boolean {
  try {
    const config = { dimensions, replacer, blur };
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
    const { dimensions, replacer, blur } = loadConfig();
    
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
    console.log(chalk.yellow(`  [B] Cài đặt hiệu ứng làm mờ (Blur) [Hiện tại: ${blur.type.toUpperCase()}]`));
    console.log(chalk.yellow('  [Q] Thoát (Quit)'));
    console.log(chalk.cyan('===================================================='));

    const choice = (await askQuestion(chalk.cyan('Nhập lựa chọn của bạn (A/D/R/B/Q): '))).toUpperCase();

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
      if (saveConfig(dimensions, replacer, blur)) {
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
      if (saveConfig(dimensions, replacer, blur)) {
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
      if (saveConfig(dimensions, newReplacer, blur)) {
        console.log(chalk.green(`\n[OK] Đã đổi chuỗi thay thế sang "${newReplacer}" thành công! Ấn enter để tiếp tục.`));
      }
      await askQuestion('');
    }
    else if (choice === 'B') {
      while (true) {
        console.clear();
        console.log(chalk.cyan('===================================================='));
        console.log(chalk.bold.cyan('        CÀI ĐẶT HIỆU ỨNG LÀM MỜ (BLUR)'));
        console.log(chalk.cyan('===================================================='));
        console.log(`Loại làm mờ hiện tại: ${chalk.bold.green(blur.type.toUpperCase())}`);
        console.log(chalk.cyan('----------------------------------------------------'));
        console.log('Chọn hiệu ứng làm mờ mới:');
        console.log('  [0] Gaussian Blur (Mịn, chất lượng cao nhất)');
        console.log('  [1] Box Blur (Làm mờ khối - Nhanh, nhẹ)');
        console.log('  [2] Smart Blur (Làm mờ thông minh - Giữ sắc nét biên)');
        console.log(chalk.cyan('----------------------------------------------------'));
        
        const blurChoice = await askQuestion(chalk.cyan('Chọn loại làm mờ [0-2] [Mặc định: 0]: '));
        if (blurChoice !== '' && blurChoice !== '0' && blurChoice !== '1' && blurChoice !== '2') {
          console.log(chalk.red('\n[LỖI] Lựa chọn không hợp lệ, hãy chọn từ 0 đến 2. Ấn enter để chọn lại.'));
          await askQuestion('');
          continue;
        }

        let newType: 'gaussian' | 'box' | 'smart' = 'gaussian';
        let newParams: Record<string, any> = {};

        if (blurChoice === '1') {
          newType = 'box';
          console.log(chalk.bold.yellow('\n--- Cài Đặt Tham Số Box Blur ---'));
          const radStr = await askQuestion('radius - Bán kính làm mờ (Số thực dương) [Mặc định: 20]: ');
          const radius = radStr ? parseFloat(radStr) : 20;
          const powStr = await askQuestion('power - Số lần lặp làm mờ (Số nguyên 1-5) [Mặc định: 2]: ');
          const power = powStr ? parseInt(powStr, 10) : 2;

          newParams = { 
            radius: isNaN(radius) || radius <= 0 ? 20 : radius, 
            power: isNaN(power) || power <= 0 ? 2 : power 
          };
        } else if (blurChoice === '2') {
          newType = 'smart';
          console.log(chalk.bold.yellow('\n--- Cài Đặt Tham Số Smart Blur ---'));
          const radStr = await askQuestion('radius - Bán kính lân cận (Số thực dương) [Mặc định: 5]: ');
          const radius = radStr ? parseFloat(radStr) : 5;
          const strStr = await askQuestion('strength - Độ mạnh làm mờ (Số thực) [Mặc định: 1.0]: ');
          const strength = strStr ? parseFloat(strStr) : 1.0;
          const thrStr = await askQuestion('threshold - Ngưỡng lọc chi tiết (-30 đến 30) [Mặc định: -0.5]: ');
          const threshold = thrStr ? parseFloat(thrStr) : -0.5;

          newParams = {
            radius: isNaN(radius) || radius <= 0 ? 5 : radius,
            strength: isNaN(strength) ? 1.0 : strength,
            threshold: isNaN(threshold) ? -0.5 : threshold
          };
        } else {
          newType = 'gaussian';
          console.log(chalk.bold.yellow('\n--- Cài Đặt Tham Số Gaussian Blur ---'));
          const sigStr = await askQuestion('sigma - Độ mịn làm mờ (Số thực dương) [Mặc định: 20]: ');
          const sigma = sigStr ? parseFloat(sigStr) : 20;
          const stepStr = await askQuestion('steps - Số bước lặp (Số nguyên 1-10) [Mặc định: 3]: ');
          const steps = stepStr ? parseInt(stepStr, 10) : 3;

          newParams = { 
            sigma: isNaN(sigma) || sigma <= 0 ? 20 : sigma, 
            steps: isNaN(steps) || steps <= 0 ? 3 : steps 
          };
        }

        const newBlur: BlurConfig = { type: newType, params: newParams };
        if (saveConfig(dimensions, replacer, newBlur)) {
          console.log(chalk.green(`\n[OK] Đã lưu cấu hình làm mờ ${newType.toUpperCase()} thành công!`));
        }
        break;
      }
      await askQuestion('\nẤn enter để tiếp tục...');
    }
  }
  process.exit(0);
}

menuLoop();
