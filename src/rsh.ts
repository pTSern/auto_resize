#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function printGuide() {
  const mdPath = path.resolve(__dirname, '../HD_SU_DUNG.md');
  if (!fs.existsSync(mdPath)) {
    console.log(chalk.red('Không tìm thấy file tài liệu hướng dẫn HD_SU_DUNG.md'));
    return;
  }

  const content = fs.readFileSync(mdPath, 'utf-8');
  const lines = content.split('\n');

  console.log('\n' + chalk.bold.cyan('='.repeat(65)));
  
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      console.log(chalk.gray(`  ${line}`));
      continue;
    }

    if (trimmed.startsWith('# ')) {
      console.log('\n' + chalk.bold.cyan(trimmed.substring(2)));
    } else if (trimmed.startsWith('## ')) {
      console.log('\n' + chalk.bold.green(trimmed.substring(3)));
    } else if (trimmed.startsWith('### ')) {
      console.log('\n' + chalk.bold.yellow(trimmed.substring(4)));
    } else if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      const marker = trimmed.charAt(0);
      const contentIndex = line.indexOf(marker) + 2;
      const rawText = line.substring(contentIndex);
      const codeRegex = /`([^`]+)`/g;
      const formattedText = rawText.replace(codeRegex, (_, p1) => chalk.bold.magenta(p1));
      console.log(`  ${chalk.yellow('•')} ${formattedText}`);
    } else if (trimmed.startsWith('> [!')) {
      const alertType = trimmed.includes('NOTE') ? 'LƯU Ý' : 'QUAN TRỌNG';
      console.log(chalk.bold.bgBlue.white(`\n  [${alertType}]  `));
    } else if (line.startsWith('> ')) {
      const rawText = line.substring(2);
      const codeRegex = /`([^`]+)`/g;
      const formattedText = rawText.replace(codeRegex, (_, p1) => chalk.bold.magenta(p1));
      console.log(chalk.blue(`  | ${formattedText}`));
    } else if (trimmed === '---') {
      console.log(chalk.cyan('-'.repeat(65)));
    } else {
      // Highlight inline code `code`
      let formatted = line;
      const codeRegex = /`([^`]+)`/g;
      formatted = formatted.replace(codeRegex, (_, p1) => chalk.bold.magenta(p1));
      console.log(formatted);
    }
  }
  console.log('\n' + chalk.bold.cyan('='.repeat(65)) + '\n');
}

// If run directly from Node
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('rsh.js') || 
  process.argv[1].endsWith('rsh') || 
  process.argv[1].includes('rsh')
);
if (isDirectRun) {
  printGuide();
  process.exit(0);
}
