// scripts/setting.js - Interactive Config Editor
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const CONFIG_PATH = path.join(os.homedir(), '.auto_resize_config.json');

function loadConfig() {
  const defaultDimensions = [
    { w: 1, h: 1 },
    { w: 16, h: 9 }
  ];

  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = { dimensions: defaultDimensions };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultDimensions;
  }

  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    const list = parsed.dimensions || parsed.demensions;
    if (Array.isArray(list)) {
      return list;
    }
  } catch (err) {
    console.log('Error reading config file, resetting to defaults.');
  }

  return defaultDimensions;
}

function saveConfig(dimensions) {
  try {
    const config = { dimensions };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.log('Failed to save config file:', err.message);
    return false;
  }
}

function askQuestion(query) {
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
    const dimensions = loadConfig();
    
    console.log('====================================================');
    console.log('        CAU HINH AUTO RESIZE VIDEO (.json)');
    console.log('====================================================');
    console.log(`Duong dan config: ${CONFIG_PATH}`);
    console.log(`Dang co tat ca ${dimensions.length} kich thuoc dang ky:`);
    console.log('----------------------------------------------------');
    
    if (dimensions.length === 0) {
      console.log('  (Trong - Khong co kich thuoc nao)');
    } else {
      dimensions.forEach((dim, idx) => {
        console.log(`  [${idx + 1}] ${dim.w}x${dim.h}`);
      });
    }
    console.log('----------------------------------------------------');
    console.log('  [A] Them kich thuoc moi (Add)');
    console.log('  [D] Xoa kich thuoc (Delete)');
    console.log('  [Q] Thoat (Quit)');
    console.log('====================================================');

    const choice = (await askQuestion('Nhap lua chon cua ban (A/D/Q): ')).toUpperCase();

    if (choice === 'Q' || choice === '') {
      console.log('Tam biet!');
      break;
    }

    if (choice === 'A') {
      console.log('\n--- Them Kich Thuoc Moi ---');
      const wStr = await askQuestion('Nhap chieu rong (Width/W) (e.g. 1 or 1920): ');
      const hStr = await askQuestion('Nhap chieu cao (Height/H) (e.g. 1 or 1080): ');

      const w = parseInt(wStr, 10);
      const h = parseInt(hStr, 10);

      if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
        console.log('\n[LOI] Kich thuoc phai la so nguyen duong hop le. An enter de quay lai.');
        await askQuestion('');
        continue;
      }

      // Check duplicate
      const duplicate = dimensions.some(d => d.w === w && d.h === h);
      if (duplicate) {
        console.log('\n[LOI] Kich thuoc nay da ton tai trong cau hinh. An enter de quay lai.');
        await askQuestion('');
        continue;
      }

      dimensions.push({ w, h });
      if (saveConfig(dimensions)) {
        console.log(`\n[OK] Da them kich thuoc ${w}x${h} thanh cong! An enter de tiep tuc.`);
      }
      await askQuestion('');
    } 
    else if (choice === 'D') {
      if (dimensions.length === 0) {
        console.log('\nHang doi config trong. Khong co gi de xoa. An enter de quay lai.');
        await askQuestion('');
        continue;
      }

      console.log('\n--- Xoa Kich Thuoc ---');
      const idxStr = await askQuestion('Nhap so thu tu muon xoa (e.g. 1): ');
      const idx = parseInt(idxStr, 10);

      if (isNaN(idx) || idx < 1 || idx > dimensions.length) {
        console.log('\n[LOI] So thu tu khong ton tai. An enter de quay lai.');
        await askQuestion('');
        continue;
      }

      const removed = dimensions.splice(idx - 1, 1)[0];
      if (saveConfig(dimensions)) {
        console.log(`\n[OK] Da xoa kich thuoc ${removed.w}x${removed.h} thanh cong! An enter de tiep tuc.`);
      }
      await askQuestion('');
    }
  }
  process.exit(0);
}

menuLoop();
